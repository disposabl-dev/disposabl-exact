import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dir, "..");
const hostname = "127.0.0.1";
const webActions = new Set(["/api/auth/web", "/api/platform/web", "/api/billing/web"]);

async function localEnv(dir) {
  const file = Bun.file(resolve(root, dir, ".env.local"));
  return await file.exists() ? parseEnv(await file.text()) : {};
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function main() {
  const [frontend, backend] = await Promise.all([localEnv("apps/apps"), localEnv("packages/backend")]);
  const site = new URL(process.env.CONVEX_SITE_ORIGIN || frontend.CONVEX_SITE_ORIGIN ||
    process.env.CONVEX_SITE_URL || backend.CONVEX_SITE_URL || "http://127.0.0.1:3211");
  const loopback = ["localhost", hostname, "[::1]"].includes(site.hostname);
  if ((site.protocol !== "https:" && !(site.protocol === "http:" && loopback)) ||
      site.href !== site.origin + "/") {
    throw new Error("Set CONVEX_SITE_URL to an HTTPS Convex site origin or a loopback HTTP origin.");
  }

  const sessionCookie = "__Host-exact-session";
  const project = createHash("sha256").update(root).update("\0").update(site.origin).digest("hex").slice(0, 20);
  const devCookie = `${sessionCookie}-${project}`;
  const port = Number(process.env.EXACT_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("EXACT_PORT must be a port number from 1 to 65535.");
  }
  const publicURL = new URL(`http://${hostname}:${port}`);
  const reservation = createServer();
  const exactPort = await listen(reservation, 0);
  const exact = new URL(`http://${hostname}:${exactPort}`);

  const server = createServer((incoming, outgoing) => {
    const { headers, method, url } = incoming;
    if (
      incoming.socket.remoteAddress !== hostname ||
      headers.host !== publicURL.host ||
      (headers.origin !== undefined && headers.origin !== publicURL.origin) ||
      Object.keys(headers).some(key => key === "forwarded" || key.startsWith("x-forwarded-")) ||
      !url?.startsWith("/") || url.startsWith("//") || url.includes("\\")
    ) {
      outgoing.writeHead(403).end();
      return;
    }

    const action = webActions.has(url);
    if (action && (method !== "POST" || headers.origin !== publicURL.origin || headers["x-exact-auth"] !== "1")) {
      outgoing.writeHead(403).end();
      return;
    }
    const target = action ? site : exact;
    let requestHeaders;
    if (action) {
      requestHeaders = { host: site.host, origin: site.origin, "x-exact-auth": "1" };
      for (const name of ["content-type", "content-length"]) {
        if (headers[name] !== undefined) requestHeaders[name] = headers[name];
      }
      const cookie = (headers.cookie ?? "").split(/; */).find(value => value.startsWith(`${devCookie}=`));
      if (cookie) requestHeaders.cookie = sessionCookie + cookie.slice(devCookie.length);
    } else {
      requestHeaders = { ...headers, host: exact.host };
      if (headers.origin) requestHeaders.origin = exact.origin;
      delete requestHeaders.cookie;
    }

    const proxyRequest = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = proxyRequest(target, { method, path: url, headers: requestHeaders }, response => {
      if (action && response.headers["set-cookie"]) {
        const sessions = response.headers["set-cookie"]
          .filter(value => value.startsWith(`${sessionCookie}=`))
          .map(value => devCookie + value.slice(sessionCookie.length));
        delete response.headers["set-cookie"];
        if (sessions.length) response.headers["set-cookie"] = sessions;
      }
      outgoing.writeHead(response.statusCode, response.headers);
      response.on("error", error => outgoing.destroy(error));
      response.pipe(outgoing);
    });
    upstream.on("error", () => {
      if (outgoing.headersSent) outgoing.destroy();
      else if (!action && method === "GET" && headers["sec-fetch-mode"] === "navigate") {
        outgoing.writeHead(503, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" })
          .end(`<!doctype html>
<meta name="viewport" content="width=device-width">
<meta http-equiv="refresh" content="2">
<title>Starting Exact</title>
<p>Exact is starting. This page will refresh automatically.</p>`);
      } else {
        outgoing.writeHead(502, { "Cache-Control": "no-store" }).end("The development server is unavailable.");
      }
    });
    outgoing.on("close", () => upstream.destroy());
    incoming.on("error", error => upstream.destroy(error));
    incoming.pipe(upstream);
  });

  try {
    await listen(server, port);
  } finally {
    await new Promise(resolve => reservation.close(resolve));
  }
  console.log(`Open the app at ${publicURL.href}`);
  const child = spawn(process.execPath, ["--no-env-file", resolve(root, "scripts/exact.mjs"), "web", "--port", String(exactPort)], {
    cwd: root,
    env: { ...process.env, CONVEX_SITE_ORIGIN: publicURL.origin },
    stdio: "inherit",
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
  } finally {
    server.close();
    server.closeAllConnections();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

try {
  await main();
} catch (error) {
  console.error(`dev-web: ${error.message}`);
  process.exitCode = 1;
}

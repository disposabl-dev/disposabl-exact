import { lock } from "proper-lockfile";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
export function openUrl(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () => console.error("Open the URL manually."));
  child.unref();
}

export class NotAuthenticated extends Error {
}
const directory = () => process.env.DISPOSABL_CONFIG_DIR || join(homedir(), ".config", "disposabl");
const sessionPath = (url) => join(directory(), `${createHash("sha256").update(url).digest("hex")}.json`);
const fetchFor = (origin) => Object.assign(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== origin)
    throw new Error("OAuth endpoint must belong to the configured API origin.");
  return fetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ?? AbortSignal.timeout(30000)
  });
}, {
  preconnect: fetch.preconnect
});
async function load(url) {
  try {
    return JSON.parse(await readFile(sessionPath(url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return {};
    throw error;
  }
}
async function save(url, session) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  await chmod(directory(), 0o700);
  const temporary = `${sessionPath(url)}.${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, JSON.stringify(session), {
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, sessionPath(url));
  } finally {
    await rm(temporary, { force: true });
  }
}
function provider(url, session, redirect, state) {
  let verifier = "";
  return {
    redirectUrl: session.redirectUrl,
    clientMetadata: {
      client_name: "Disposabl CLI",
      redirect_uris: session.redirectUrl ? [session.redirectUrl] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    },
    state: () => state ?? "",
    clientInformation: () => session.client,
    saveClientInformation: (client) => {
      session.client = client;
    },
    tokens: () => session.tokens,
    saveTokens: async (tokens) => {
      session.tokens = tokens;
      session.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0;
      await save(url, session);
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    redirectToAuthorization: redirect,
    invalidateCredentials: async (scope) => {
      if (scope === "all" || scope === "tokens") {
        delete session.tokens;
        delete session.expiresAt;
      }
      if (scope === "all" || scope === "client")
        delete session.client;
      if (scope === "all" || scope === "verifier")
        verifier = "";
      await save(url, session);
    }
  };
}
async function unlockedLogin(url, openBrowser = true) {
  const state = randomBytes(32).toString("base64url");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not bind the login callback.");
  const session = {
    redirectUrl: `http://127.0.0.1:${address.port}/callback`
  };
  const oauth = provider(url, session, (authorizationUrl) => {
    if (authorizationUrl.origin !== url)
      throw new Error("Unexpected authorization server.");
    console.error(`Open this URL to sign in:
${authorizationUrl.href}`);
    if (openBrowser)
      openUrl(authorizationUrl.href);
  }, state);
  let timer;
  let rejectCallback;
  const interrupt = () => rejectCallback(new Error("Sign-in paused."));
  try {
    const callback = new Promise((resolve, reject) => {
      rejectCallback = reject;
      timer = setTimeout(() => reject(new Error("Login timed out. Start login again.")), 300000);
      server.on("request", async (request, response) => {
        const callbackUrl = new URL(request.url ?? "/", session.redirectUrl);
        const invalid = request.method !== "GET" || request.headers.host !== `127.0.0.1:${address.port}` || callbackUrl.pathname !== "/callback" || callbackUrl.searchParams.getAll("state").length !== 1 || callbackUrl.searchParams.get("state") !== state;
        if (invalid) {
          response.writeHead(400).end("Invalid login callback.");
          return;
        }
        try {
          if (callbackUrl.searchParams.get("iss")?.replace(/\/$/, "") !== url)
            throw new Error("Unexpected OAuth issuer.");
          const code = callbackUrl.searchParams.get("code");
          if (!code || callbackUrl.searchParams.getAll("code").length !== 1 || callbackUrl.searchParams.has("error"))
            throw new Error("Login was not approved.");
          const result = await auth(oauth, {
            serverUrl: `${url}/mcp`,
            authorizationCode: code,
            fetchFn: fetchFor(url)
          });
          if (result !== "AUTHORIZED")
            throw new Error("Login did not complete.");
          response.writeHead(200, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store"
          }).end("Signed in. You can close this tab.");
          resolve();
        } catch (error) {
          response.writeHead(400).end("Login failed. Return to your terminal.");
          reject(error);
        }
      });
    });
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const authorize = auth(oauth, { serverUrl: `${url}/mcp`, fetchFn: fetchFor(url) });
    await Promise.race([authorize.then(() => callback), callback]);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}
async function unlockedAccessToken(url, forceRefresh = false) {
  if (process.env.DISPOSABL_API_KEY)
    return process.env.DISPOSABL_API_KEY;
  const session = await load(url);
  if (!session.tokens)
    throw new NotAuthenticated("Run disposabl login or set DISPOSABL_API_KEY.");
  if (forceRefresh || !session.expiresAt || Date.now() >= session.expiresAt - 30000) {
    if (!session.client || !session.tokens.refresh_token)
      throw new NotAuthenticated("Session cannot be renewed. Sign in again or start a newly authorized agent run.");
    const oauth = provider(url, session, () => {
      throw new NotAuthenticated("Session expired. Run disposabl login again.");
    });
    await auth(oauth, { serverUrl: `${url}/mcp`, fetchFn: fetchFor(url) });
  }
  if (!session.tokens)
    throw new NotAuthenticated("Session expired. Run disposabl login again.");
  return session.tokens.access_token;
}
async function unlockedLogout(url) {
  const session = await load(url);
  if (session.tokens) {
    for (const token of [
      session.tokens.refresh_token,
      session.tokens.access_token
    ].filter(Boolean)) {
      const response = await fetchFor(url)(`${url}/mcp/oauth/revoke`, {
        method: "POST",
        body: new URLSearchParams({
          token,
          client_id: session.client?.client_id ?? ""
        })
      });
      if (!response.ok)
        throw new Error("Revocation failed; credentials retained so logout can be retried.");
    }
  }
  await rm(sessionPath(url), { force: true });
}
async function withCredentials(url, operation) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const release = await lock(sessionPath(url), {
    realpath: false,
    stale: 1e4,
    retries: { retries: 8, minTimeout: 100, maxTimeout: 1000 }
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}
export const login = (url, browser = true) => withCredentials(url, () => unlockedLogin(url, browser));
export const accessToken = (url, refresh = false) => withCredentials(url, () => unlockedAccessToken(url, refresh));
export const logout = (url) => withCredentials(url, () => unlockedLogout(url));
export const hasCredentials = async (url) => Boolean(process.env.DISPOSABL_API_KEY || (await load(url)).tokens?.access_token);

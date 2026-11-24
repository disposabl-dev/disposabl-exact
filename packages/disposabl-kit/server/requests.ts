import { httpCookies, type HttpCookies } from "@convex-dev/auth/ssr";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../backend/convex/_generated/api";
import { env } from "../../backend/convex/_generated/server";
import { siteOrigin } from "../../backend/convex/authSettings";

export const cookieName = "__Host-exact-session";
export const sessionHeader = "X-Exact-Session";
export const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const statePattern = /^[a-f0-9-]{36}$/;
export const tokenPattern = /^[a-zA-Z0-9._-]{1,2048}$/;

export function readSession(raw: string | null | undefined) {
  const parts = raw?.split("~");
  if (parts?.length !== 2 || !parts.every((part) => tokenPattern.test(part))) return null;
  const [accessToken, refreshToken] = parts;
  return { accessToken, refreshToken };
}

export function reply(body: object, status = 200, cookies?: HttpCookies) {
  const response = Response.json(body, { status, headers: privateHeaders });
  cookies?.applyTo(response.headers);
  return response;
}

export async function readRequestText(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return null;
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await readRequestText(request);
  if (text === null) return null;
  try {
    const data: unknown = JSON.parse(text);
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const authClient = (accessToken: string) =>
  new ConvexHttpClient(env.CONVEX_CLOUD_URL, { auth: accessToken, logger: false });

export async function requestClient(request: Request, web: boolean) {
  const active = readSession(web ? await httpCookies(request).get(cookieName) : request.headers.get(sessionHeader));
  return active && authClient(active.accessToken);
}

export async function platformSession(request: Request) {
  const client = await requestClient(request, true);
  if (!client) return null;
  const account = await client.query(api.auth.viewer, {}).catch(() => null);
  return account ? client : null;
}

export function isAppRequest(request: Request, web: boolean) {
  const origin = request.headers.get("Origin");
  return request.headers.get("X-Exact-Auth") === "1" && (web ? origin === siteOrigin() : origin === null);
}

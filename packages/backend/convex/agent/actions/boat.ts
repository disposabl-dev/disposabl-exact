import { env } from "../../_generated/server";

const baseUrl = "https://boat.dev/api/v1";

type Sandbox = { id: string; state: string; snapshots?: boolean };
type BoatEvent = { id: string; timestamp: number; type: string; data?: { content?: unknown } };
type Prompt = { promptId: string; conversationId: string };

export class BoatError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("Boat request failed.");
  }
}

function required(value: string | undefined) {
  if (!value?.trim()) throw new Error("Coding agent configuration is incomplete.");
  return value.trim();
}

async function request<T>(path: string, options: { method?: string; body?: object; key?: string } = {}): Promise<T> {
  const response = await fetch(baseUrl + path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + required(env.BOAT_API_KEY),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    body: options.body && JSON.stringify(options.body),
    redirect: "error",
    signal: AbortSignal.timeout(75_000),
  });
  const result = await response.json().catch(() => null) as (T & { ok?: boolean; code?: string }) | null;
  if (!result || !response.ok || result.ok === false) throw new BoatError(response.status, result?.code);
  return result;
}

const path = (id: string) => "/sandboxes/" + encodeURIComponent(id);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function readySandbox(existing: string | undefined, key: string) {
  const deadline = Date.now() + 3 * 60_000;
  const environment = required(env.BOAT_AGENT_ENVIRONMENT);
  const { environments } = await request<{
    environments: Array<{ name: string; safeForThirdParties: boolean; proxyAiCredentials?: boolean }>;
  }>("/environments");
  const profile = environments.find(item => item.name === environment);
  if (!profile?.safeForThirdParties || !profile.proxyAiCredentials) {
    throw new BoatError(400, "unsafe_environment");
  }
  let id = existing;
  while (Date.now() < deadline) {
    if (!id) {
      try {
        const created = await request<{ id: string }>("/sandboxes", {
          key,
          body: {
            environment, type: "default", ttlSeconds: 1800,
            snapshots: env.BOAT_AGENT_SNAPSHOTS !== "false",
            ...(env.BOAT_AGENT_SNAPSHOT ? { from: env.BOAT_AGENT_SNAPSHOT } : {}),
          },
        });
        id = created.id;
      } catch (error) {
        if (error instanceof BoatError && error.status < 500 && error.code !== "idempotency_in_progress") throw error;
      }
    }
    if (id) {
      try {
        const { sandbox } = await request<{ sandbox: Sandbox }>(path(id));
        if (["ready", "idle", "running"].includes(sandbox.state)) return id;
        if (["archived", "error", "cancelled"].includes(sandbox.state)) {
          if (sandbox.snapshots === false || sandbox.state === "cancelled") {
            if (id !== existing) throw new Error("New sandbox failed to start.");
            id = undefined;
          }
          else await request(path(id) + "/resume", { body: { environment, ttlSeconds: 1800 } });
        }
      } catch (error) {
        if (error instanceof BoatError && (error.status === 404 ||
          ["snapshots_disabled", "snapshot_data_expired", "resume_failed"].includes(error.code ?? ""))) {
          if (id !== existing) throw error;
          id = undefined;
        } else if (!(error instanceof BoatError) || error.status !== 409) {
          throw error;
        }
      }
    }
    await delay(1_500);
  }
  throw new Error("Sandbox did not become ready.");
}

async function whenReady<T>(operation: () => Promise<T>) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 5 || !(error instanceof BoatError) ||
        !["sandbox_starting", "sandbox_not_ready", "sandbox_direct_failed"].includes(error.code ?? "")) throw error;
      await delay(attempt * 1_000);
    }
  }
}

export async function writeFile(id: string, file: string, content: string) {
  await whenReady(() => request(path(id) + "/files", { method: "PUT", body: { path: file, content } }));
}

export async function command(id: string, command: string, timeoutSeconds = 30) {
  const result = await whenReady(() => request<{ success: boolean; stdout: string }>(
    path(id) + "/commands", { body: { command, timeoutSeconds } },
  ));
  if (!result.success) throw new Error("Sandbox setup command failed.");
  return result.stdout;
}

export function runPrompt(id: string, prompt: string, conversationId?: string) {
  return request<Prompt>(path(id) + "/prompt", { body: {
    provider: "codex", model: env.BOAT_AGENT_MODEL || "gpt-6.2-sol", speed: "ultrafast", prompt,
    ...(conversationId ? { conversationId } : { new: true }),
  } });
}

export function promptStatus(id: string, promptId: string) {
  return request<{ status: string; done: boolean }>(path(id) + "/prompts/" + encodeURIComponent(promptId));
}

export function events(id: string, conversationId: string, cursor?: string, latest = false) {
  const query = new URLSearchParams({ conversation: conversationId, sort: latest ? "desc" : "asc", limit: latest ? "1" : "100" });
  if (cursor) query.set("cursor", cursor);
  return request<{ events: BoatEvent[]; pageInfo?: { nextCursor?: string; hasMore: boolean } }>(path(id) + "/events?" + query.toString());
}

export function eventCursor(event: BoatEvent) {
  return Buffer.from(`${event.timestamp}:${event.id}`).toString("base64url");
}

export async function interrupt(id: string, conversationId: string) {
  await request(path(id) + "/interrupt?" + new URLSearchParams({ conversation: conversationId }).toString(), { method: "POST" });
}

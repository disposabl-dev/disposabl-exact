import { Boat, type SandboxRef } from "@boatdev/convex";
import { components } from "../../_generated/api";
import { env, type ActionCtx } from "../../_generated/server";

export const boat = new Boat(components.boat);
export const sandboxRef = (userId: string): SandboxRef => ({ ownerId: userId, key: "workspace" });
export const getSandbox = (ctx: ActionCtx, ref: SandboxRef) => ctx.runQuery(components.boat.sandboxes.get, ref);

type Prompt = { promptId: string; conversationId: string };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class BoatError extends Error {
  constructor(readonly code?: string) {
    super("Boat request failed.");
  }
}

function required(value: string | undefined) {
  if (!value?.trim()) throw new Error("Coding agent configuration is incomplete.");
  return value.trim();
}

// The published component does not expose environment inspection, prompt speed, or interrupt.
async function request<T>(path: string, body?: object) {
  const response = await fetch(`https://boat.dev/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${required(env.BOAT_API_KEY)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body && JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(75_000),
  });
  const result = await response.json().catch(() => null) as (T & { ok?: boolean; code?: string; error?: { code?: string } }) | null;
  if (!result || !response.ok || result.ok === false) throw new BoatError(result?.code ?? result?.error?.code);
  return result;
}

export async function readySandbox(ctx: ActionCtx, ref: SandboxRef) {
  const environment = required(env.BOAT_AGENT_ENVIRONMENT);
  const { environments } = await request<{
    environments: Array<{ name: string; safeForThirdParties: boolean; proxyAiCredentials?: boolean }>;
  }>("/environments");
  const profile = environments.find(item => item.name === environment);
  if (!profile?.safeForThirdParties || !profile.proxyAiCredentials) throw new BoatError("unsafe_environment");

  const options = { environment, ttlSeconds: 1800 };
  let sandbox = await getSandbox(ctx, ref);
  sandbox = sandbox?.sandboxId ? await boat.refresh(ctx, ref) : await boat.create(ctx, {
    ...ref, options: { ...options, type: "default", from: env.BOAT_AGENT_SNAPSHOT },
  });
  if (sandbox.state === "archived" || sandbox.state === "error") sandbox = await boat.resume(ctx, { ...ref, options });

  const deadline = Date.now() + 3 * 60_000;
  while (sandbox && Date.now() < deadline) {
    if (sandbox.sandboxId && ["ready", "idle", "running"].includes(sandbox.state)) return sandbox.sandboxId;
    if (["archived", "error", "cancelled"].includes(sandbox.state)) break;
    // The component tracks transitions after create, refresh, or resume.
    await delay(1_500);
    sandbox = await getSandbox(ctx, ref);
  }
  throw new Error("Sandbox did not become ready.");
}

async function whenReady<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 5 || !(error instanceof Error) ||
          !/\bBoat API \d+ (sandbox_starting|sandbox_not_ready|sandbox_direct_failed)\b/.test(error.message)) throw error;
      await delay(attempt * 1_000);
    }
  }
}

export function writeFile(ctx: ActionCtx, ref: SandboxRef, path: string, content: string) {
  return whenReady(() => boat.writeFile(ctx, { ...ref, path, content }));
}

export async function command(ctx: ActionCtx, ref: SandboxRef, command: string, timeoutSeconds = 30) {
  const result = await whenReady(() => boat.exec(ctx, { ...ref, command, timeoutSeconds }));
  if (result.exitCode !== 0 || result.timedOut) throw new Error("Sandbox setup command failed.");
}

const path = (id: string) => `/sandboxes/${encodeURIComponent(id)}`;

export function runPrompt(id: string, prompt: string) {
  return request<Prompt>(path(id) + "/prompt", {
    provider: "codex", model: env.BOAT_AGENT_MODEL || "gpt-6.2-sol", speed: "ultrafast", prompt, new: true,
  });
}

export async function interrupt(id: string, conversationId: string) {
  const query = new URLSearchParams({ conversation: conversationId });
  await request(`${path(id)}/interrupt?${query.toString()}`, {});
}

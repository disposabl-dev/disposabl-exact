import { v, type Infer } from "convex/values";

export const provider = v.union(v.literal("github"), v.literal("convex"));
export type Provider = Infer<typeof provider>;
export const user = { userId: v.id("users") };
export const connectLink = v.object({ url: v.string() });
export const githubAccount = v.object({ owner: v.string(), installationId: v.string() });
export const convexAccount = v.object({ teamId: v.number(), accessToken: v.string() });
export const githubStatus = v.object({ connected: v.boolean(), owner: v.optional(v.string()) });
export const convexStatus = v.object({ connected: v.boolean(), teamId: v.optional(v.number()) });
export const connectionsStatus = v.object({ github: githubStatus, convex: convexStatus });
export const flow = v.object({
  stateHash: v.string(),
  expiresAt: v.number(),
  verifier: v.optional(v.string()),
  githubAccounts: v.optional(v.array(githubAccount)),
});
export const flowArgs = { provider, stateHash: v.string() };
export const callbackArgs = { provider, state: v.string(), code: v.string() };
export const githubSelectionArgs = { state: v.string(), installationId: v.string() };
export const callbackResult = v.union(
  v.object({ status: v.literal("connected") }),
  v.object({ status: v.literal("choose"), accounts: v.array(githubAccount) }),
  v.object({ status: v.literal("install"), installUrl: v.string(), continueUrl: v.string() }),
);

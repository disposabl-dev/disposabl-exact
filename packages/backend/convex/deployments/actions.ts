"use node";

import { v, type Infer } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { audience, deploymentIdentity, recordResult, report as reportArgs } from "./validation";

const issuer = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
const result = v.union(recordResult, v.literal("unauthorized"));

export const report = internalAction({
  args: { token: v.string(), report: reportArgs },
  returns: result,
  handler: async (ctx, { token, report }): Promise<Infer<typeof result>> => {
    const identity = await jwtVerify(token, keys, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "nbf"] })
      .then(({ payload }) => deploymentIdentity(payload), () => null);
    if (!identity) return "unauthorized" as const;
    return ctx.runMutation(internal.deployments.internal.record, { ...identity, ...report });
  },
});

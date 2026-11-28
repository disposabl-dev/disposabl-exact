import { checkValue, McpServer } from "@convex-dev/mcp";
import type { Infer } from "convex/values";
import { siteOrigin } from "../../../disposabl-kit/server/authSettings";
import { reply } from "../../../disposabl-kit/server/requests";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { publishPath, publishResultArgs } from "./validators";

const publisher = new McpServer<Id<"users">>(components.mcp, {
  name: "disposabl-publish",
  title: "Disposabl app publishing",
  version: "1.0.0",
  siteUrl: siteOrigin(),
  consentUrl: siteOrigin() + "/consent",
  path: publishPath,
  tools: {},
});

function httpsUrl(value: string) {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const publish = httpAction(async (ctx, request) => {
  const key = await publisher.authenticate(ctx, request);
  if (!key?.connectionId) return reply({ error: "unauthorized" }, 401);

  const result = checkValue(publishResultArgs, await request.json().catch(() => null));
  if (!result.ok) return reply({ error: "invalid_arguments" }, 400);
  const input = result.value as Infer<typeof publishResultArgs>;
  if (!/^[a-f0-9]{40}$/.test(input.commitSha) || (input.url !== undefined && !httpsUrl(input.url))) {
    return reply({ error: "invalid_arguments" }, 400);
  }
  const saved = await ctx.runMutation(internal.apps.internal.recordPublish, {
    ...input, userId: key.userId, keyId: key.connectionId,
  });
  return saved ? reply({ ok: true }) : reply({ error: "unauthorized" }, 401);
});

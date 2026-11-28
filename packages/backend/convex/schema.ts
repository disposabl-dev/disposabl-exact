import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { activeTurn } from "./agent/validators";
import { convexAccount, flow, githubAccount } from "./connections/validators";

const platformResult = v.object({
  url: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("building"),
    v.literal("done"),
    v.literal("error"),
  ),
  commitSha: v.optional(v.string()),
});

const optionalResult = v.optional(platformResult);
const previewPlatforms = v.object({
  web: optionalResult,
  api: optionalResult,
  mcp: optionalResult,
  android: optionalResult,
  ios: optionalResult,
  macos: optionalResult,
});

const appPlatforms = v.union(
  v.null(),
  previewPlatforms.extend({
    cli: optionalResult,
    sdk: optionalResult,
  }),
);

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    agentTurn: v.optional(activeTurn),
  }).index("by_agentTurn_tokenHash", ["agentTurn.tokenHash"]),

  apps: defineTable({
    userId: v.id("users"),
    slug: v.string(),
    name: v.string(),
    githubOwner: v.string(),
    githubRepoName: v.string(),
    convexProjectId: v.number(),
    convexSiteUrl: v.optional(v.string()),
    prod: appPlatforms,
    live: appPlatforms,
    agentThreadId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_agentThreadId", ["agentThreadId"]),

  previews: defineTable({
    appSlug: v.string(),
    previewName: v.string(),
    previewSlug: v.string(),
    platforms: previewPlatforms,
  })
    .index("by_appSlug", ["appSlug"])
    .index("by_previewSlug", ["previewSlug"]),

  connections: defineTable({
    userId: v.id("users"),
    github: v.optional(githubAccount),
    convex: v.optional(convexAccount),
    githubFlow: v.optional(flow),
    convexFlow: v.optional(flow),
  })
    .index("by_userId", ["userId"])
    .index("by_github_state", ["githubFlow.stateHash"])
    .index("by_convex_state", ["convexFlow.stateHash"]),
});

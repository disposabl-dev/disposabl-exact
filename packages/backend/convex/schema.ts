import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
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
  }),

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
    .index("by_slug", ["slug"]),

  previews: defineTable({
    appSlug: v.string(),
    previewName: v.string(),
    previewSlug: v.string(),
    platforms: previewPlatforms,
  })
    .index("by_appSlug", ["appSlug"])
    .index("by_previewSlug", ["previewSlug"]),

  agentSandboxes: defineTable({
    userId: v.id("users"),
    sandboxId: v.optional(v.string()),
    activeTurnId: v.optional(v.id("agentTurns")),
  }).index("by_userId", ["userId"]),

  agentTurns: defineTable({
    userId: v.id("users"),
    threadId: v.string(),
    appSlug: v.optional(v.string()),
    messageId: v.string(),
    assistantMessageId: v.string(),
    streamId: v.string(),
    deadline: v.number(),
    sandboxId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    promptId: v.optional(v.string()),
    cursor: v.optional(v.string()),
    text: v.string(),
    parts: v.number(),
    tokenHash: v.optional(v.string()),
    cancelled: v.optional(v.boolean()),
    done: v.boolean(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_tokenHash", ["tokenHash"]),

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

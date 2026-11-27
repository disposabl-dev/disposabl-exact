import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  users: defineTable({ name: v.optional(v.string()) }),

  apps: defineTable({
    userId: v.id("users"),
    slug: v.string(),
    name: v.string(),
    githubOwner: v.string(),
    githubRepoName: v.string(),
    convexProjectId: v.number(),
    prod: appPlatforms,
    live: appPlatforms,
    agentThreadId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_slug", ["slug"]),

  previews: defineTable({
    appId: v.id("apps"),
    previewName: v.string(),
    previewSlug: v.string(),
    gitRef: v.optional(v.string()),
    platforms: previewPlatforms,
  })
    .index("by_appId_and_gitRef", ["appId", "gitRef"])
    .index("by_previewSlug", ["previewSlug"]),

  connections: defineTable({
    userId: v.id("users"),
    github: v.optional(v.object({
      owner: v.string(),
      installationId: v.string(),
    })),
    convex: v.optional(v.object({
      teamId: v.number(),
      accessToken: v.string(),
    })),
  }).index("by_userId", ["userId"]),
});

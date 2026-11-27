// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const releaseStatus = v.union(
  v.literal("pending"),
  v.literal("building"),
  v.literal("done"),
  v.literal("error"),
);
const optionalStatus = v.optional(releaseStatus);

const release = v.object({
  appId: v.id("apps"),
  // This status tracks the default URL. Other targets update independently.
  status: releaseStatus,
  url: v.optional(v.string()),
  mcpUrl: v.optional(v.string()),
  mcpStatus: optionalStatus,
  apiUrl: v.optional(v.string()),
  apiStatus: optionalStatus,
  androidUrl: v.optional(v.string()),
  androidStatus: optionalStatus,
  iosUrl: v.optional(v.string()),
  iosStatus: optionalStatus,
  macosUrl: v.optional(v.string()),
  macosStatus: optionalStatus,
});

const commitShas = v.object({
  web: v.optional(v.string()),
  mcp: v.optional(v.string()),
  api: v.optional(v.string()),
  android: v.optional(v.string()),
  ios: v.optional(v.string()),
  macos: v.optional(v.string()),
});

const connection = v.object({
  userId: v.id("users"),
  accountId: v.string(),
});

export default defineSchema(
  {
    documents: defineTable({
      fieldOne: v.string(),
      fieldTwo: v.object({
        subFieldOne: v.array(v.number()),
      }),
    }),
    users: defineTable({ name: v.optional(v.string()) }),
    counters: defineTable({
      name: v.literal("shared"),
      count: v.number(),
    }).index("by_name", ["name"]),

    apps: defineTable({
      userId: v.id("users"),
      slug: v.string(),
      name: v.string(),
      githubOwner: v.string(),
      githubRepoName: v.string(),
      convexProjectId: v.number(),
      // An omitted connection means this app uses the managed account for that provider.
      githubConnectionId: v.optional(v.id("connections")),
      convexConnectionId: v.optional(v.id("connections")),
    })
      .index("by_userId", ["userId"])
      .index("by_slug", ["slug"]),

    previews: defineTable({
      appId: v.id("apps"),
      previewName: v.string(),
      // Stores the full hostname label. Availability checks must also look up apps.slug.
      previewSlug: v.string(),
      gitRef: v.string(),
    })
      .index("by_appId_and_gitRef", ["appId", "gitRef"])
      .index("by_previewSlug", ["previewSlug"]),

    releases: defineTable(
      v.union(
        release.extend({
          environment: v.literal("preview"),
          previewId: v.id("previews"),
          commitShas: v.optional(commitShas),
        }),
        release.extend({
          environment: v.union(v.literal("production"), v.literal("live")),
          cliUrl: v.optional(v.string()),
          cliStatus: optionalStatus,
          sdkUrl: v.optional(v.string()),
          sdkStatus: optionalStatus,
          commitShas: v.optional(commitShas.extend({
            cli: v.optional(v.string()),
            sdk: v.optional(v.string()),
          })),
        }),
      ),
    ).index("by_appId_and_environment_and_previewId", ["appId", "environment", "previewId"]),

    connections: defineTable(
      v.union(
        connection.extend({
          provider: v.literal("github"),
          owner: v.string(),
          installationId: v.optional(v.string()),
        }),
        connection.extend({
          provider: v.literal("convex"),
          teamName: v.string(),
          encryptedAccessToken: v.optional(v.string()),
        }),
      ),
    ).index("by_userId_and_provider_and_accountId", ["userId", "provider", "accountId"]),
  },
  // If you ever get an error about schema mismatch
  // between your data and your schema, and you cannot
  // change the schema to match the current data in your database,
  // you can:
  //  1. Use the dashboard to delete tables or individual documents
  //     that are causing the error.
  //  2. Change this option to `false` and make changes to the data
  //     freely, ignoring the schema. Don't forget to change back to `true`!
  { schemaValidation: true }
);

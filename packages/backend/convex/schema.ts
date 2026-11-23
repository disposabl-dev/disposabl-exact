// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { billingOffer, billingTransaction } from "./billingTypes";

export default defineSchema(
  {
    documents: defineTable({
      fieldOne: v.string(),
      fieldTwo: v.object({
        subFieldOne: v.array(v.number()),
      }),
    }),
    users: defineTable({ name: v.optional(v.string()) }),
    billingAccounts: defineTable({
      userId: v.id("users"),
      token: v.string(),
      topupCredits: v.number(),
      previewTopupCredits: v.number(),
    }).index("by_userId", ["userId"]).index("by_token", ["token"]),
    billingTransactions: defineTable(billingTransaction.extend({
      userId: v.id("users"),
      preview: v.boolean(),
      credited: v.number(),
    }))
      .index("by_platform_and_transactionId", ["platform", "transactionId"])
      .index("by_userId_and_preview_and_offer_and_revoked_and_expiresAt", ["userId", "preview", "offer", "revoked", "expiresAt"])
      .index("by_platform_and_reference", ["platform", "reference"]),
    billingCheckouts: defineTable({
      userId: v.id("users"),
      offer: billingOffer,
      requestId: v.string(),
      url: v.optional(v.string()),
      expiresAt: v.number(),
    }).index("by_userId_and_offer_and_requestId", ["userId", "offer", "requestId"])
      .index("by_userId_and_offer_and_expiresAt", ["userId", "offer", "expiresAt"]),
    counters: defineTable({
      name: v.literal("shared"),
      count: v.number(),
    }).index("by_name", ["name"]),
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

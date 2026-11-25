import { internalQuery } from "@disposabl-kit/server";
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";

const counter = (db: QueryCtx["db"]) =>
  db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "shared"))
    .unique();

const counterResult = v.object({ count: v.number() });
const readCounter = async ({ db }: QueryCtx) => ({
  count: (await counter(db))?.count ?? 0,
});

// The starter's public demo shares one counter with every installation.
export const get = query({
  args: {},
  returns: counterResult,
  handler: readCounter,
});

export const current = internalQuery({
  platforms: true,
  description: "Read the current value of the shared demo counter.",
  args: { userId: v.id("users") },
  returns: counterResult,
  handler: readCounter,
});

export const increment = mutation({
  args: {},
  returns: v.null(),
  handler: async ({ db }) => {
    const current = await counter(db);
    if (current) {
      await db.patch("counters", current._id, { count: current.count + 1 });
    } else {
      await db.insert("counters", { name: "shared", count: 1 });
    }
    return null;
  },
});

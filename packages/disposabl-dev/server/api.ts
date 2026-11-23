import { httpActionGeneric, type HttpRouter } from "convex/server";
import type { PublicRead } from "./functions";

export function registerApi(router: HttpRouter, reads: readonly PublicRead[]) {
  for (const read of reads) {
    router.route({
      path: read.path,
      method: "GET",
      handler: httpActionGeneric(async (ctx) =>
        Response.json(await ctx.runQuery(read.query, {}), {
          headers: { "Cache-Control": "no-store" },
        }),
      ),
    });
  }
}

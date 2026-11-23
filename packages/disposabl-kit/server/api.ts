import { checkValue } from "@convex-dev/mcp";
import { httpActionGeneric, type HttpRouter } from "convex/server";
import { convexToJson, v } from "convex/values";
import {
  platformScope,
  runPlatformOperation,
  type AuthenticatePlatform,
  type PlatformOperation,
} from "./functions";

function queryArgs(request: Request, operation: PlatformOperation) {
  const params = new URL(request.url).searchParams;
  return Object.fromEntries(
    [...params].map(([name, value]) => {
      if (params.getAll(name).length !== 1)
        throw new Error("Repeated query parameter");
      const kind = operation.args[name]?.kind;
      const expectsString =
        kind === "string" ||
        kind === "id" ||
        kind === "bytes" ||
        kind === "int64";
      return [name, expectsString ? value : JSON.parse(value)];
    }),
  );
}

export function registerApi(
  router: HttpRouter,
  operations: readonly PlatformOperation[],
  authenticate: AuthenticatePlatform,
) {
  for (const operation of operations) {
    const method = operation.kind === "query" ? "GET" : "POST";
    const validator = v.object(operation.args);
    const handler = httpActionGeneric(async (ctx, request) => {
      const user = await authenticate(ctx, request);
      if (!user || user.clientId !== undefined)
        return Response.json(
          { error: "unauthorized" },
          { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
        );
      if (!user.scopes.includes(platformScope(operation)))
        return Response.json({ error: "insufficient_scope" }, { status: 403 });

      if (request.method !== method)
        return Response.json(
          { error: "method_not_allowed" },
          { status: 405, headers: { Allow: method } },
        );
      const contentType = request.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (method === "POST" && contentType !== "application/json")
        return Response.json({ error: "expected_json_body" }, { status: 415 });

      let input: unknown;
      try {
        input =
          method === "GET"
            ? queryArgs(request, operation)
            : await request.json();
      } catch {
        return Response.json({ error: "invalid_arguments" }, { status: 400 });
      }
      const parsed = checkValue(validator, input);
      if (!parsed.ok)
        return Response.json({ error: "invalid_arguments" }, { status: 400 });
      return Response.json(
        convexToJson(
          await runPlatformOperation(
            ctx,
            operation,
            parsed.value as Record<string, unknown>,
            user.userId,
          ),
        ),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    });
    router.route({ path: operation.path, method: "GET", handler });
    router.route({ path: operation.path, method: "POST", handler });
  }
}

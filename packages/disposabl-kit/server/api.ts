import { httpActionGeneric, type HttpRouter } from "convex/server";
import { runPlatformOperation, type PlatformOperation } from "./functions";

function queryArgs(request: Request, operation: PlatformOperation) {
  const params = new URL(request.url).searchParams;
  return Object.fromEntries(
    [...params].map(([name, value]) => {
      if (params.getAll(name).length !== 1)
        throw new Error("Repeated query parameter");
      const property = operation.inputSchema.properties?.[name];
      const expectsString =
        typeof property === "object" && property.type === "string";
      return [name, expectsString ? value : JSON.parse(value)];
    }),
  );
}

export function registerApi(
  router: HttpRouter,
  operations: readonly PlatformOperation[],
) {
  for (const operation of operations) {
    const method = operation.kind === "query" ? "GET" : "POST";
    const handler = httpActionGeneric(async (ctx, request) => {
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
      const parsed = operation.input.safeParse(input);
      if (!parsed.success)
        return Response.json({ error: "invalid_arguments" }, { status: 400 });
      return Response.json(
        await runPlatformOperation(ctx, operation, parsed.data),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    });
    router.route({ path: operation.path, method: "GET", handler });
    router.route({ path: operation.path, method: "POST", handler });
  }
}

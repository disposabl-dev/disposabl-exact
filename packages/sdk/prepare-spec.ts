// The build consumes the app's OpenAPI contract. The consumer supplies the deployment URL.
type QueryParameter = {
  in: string;
  name: string;
  content?: Record<string, unknown>;
};
type Paths = Record<string, { get?: { parameters?: QueryParameter[] } }>;

const origin = process.env.DISPOSABL_API_ORIGIN;
if (!origin)
  throw new Error(
    "Set DISPOSABL_API_ORIGIN to an Exact HTTP API with api enabled.",
  );
const response = await fetch(new URL("/openapi.json", origin), {
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok)
  throw new Error(`Could not load OpenAPI (HTTP ${response.status}).`);
const { servers: _, ...spec } = await response.json();
if (!spec.openapi || !spec.paths)
  throw new Error("Expected an OpenAPI document.");
await Bun.write(".openapi.json", JSON.stringify(spec));

// Exact uses JSON in query parameters whose schema is described by content.
const queryParameters = Object.fromEntries(
  Object.entries(spec.paths as Paths).flatMap(([path, methods]) => {
    const fields =
      methods.get?.parameters
        ?.filter((parameter) => parameter.in === "query" && parameter.content)
        .map((parameter) => parameter.name) ?? [];
    return fields.length ? [[path, fields]] : [];
  }),
);
await Bun.write(
  "src/query-parameters.generated.ts",
  `export const jsonQueryParameters: Record<string, string[]> = ${JSON.stringify(queryParameters)};
`,
);

import { tool } from "@convex-dev/mcp";
import {
  platformScope,
  runPlatformOperation,
  type PlatformOperation,
} from "./functions";

export function createPlatformTools(operations: readonly PlatformOperation[]) {
  return Object.fromEntries(
    operations.map((operation) => [
      operation.name,
      tool({
        description: operation.description,
        args: operation.args,
        returns: operation.returns,
        annotations: { readOnlyHint: operation.kind === "query" },
        scope: platformScope(operation),
        handler: (ctx, args, user) =>
          runPlatformOperation(ctx, operation, args, user.userId),
      }),
    ]),
  );
}

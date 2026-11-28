import { readBody, reply } from "../../../disposabl-kit/server/requests";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { parseReport } from "./validation";

export const reportDeployment = httpAction(async (ctx, request) => {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-zA-Z0-9._-]{1,16000})$/i)?.[1];
  if (!token) return reply({ error: "GitHub Actions identity required." }, 401);
  const json = await readBody(request);
  const report = json && parseReport(json);
  if (!report) return reply({ error: "Invalid deployment report." }, 400);
  const result = await ctx.runAction(internal.deployments.actions.report, { token, report });
  if (result === "unauthorized") return reply({ error: "Untrusted GitHub Actions workflow." }, 401);
  if (result === "not_found") return reply({ error: "GitHub repository is not linked." }, 404);
  if (result === "invalid_url") return reply({ error: "URL does not match the app deployment." }, 400);
  return reply({ status: result });
});

import { v, type Infer } from "convex/values";

export const audience = "https://www.disposabl.dev/github/deployments";
const workflow = ".github/workflows/deploy.yml";
const reusableWorkflow = `disposabl-dev/disposabl-exact/${workflow}@refs/heads/main`;
const platforms = ["web", "api", "mcp", "android", "ios", "macos"] as const;
const statuses = ["building", "done", "error"] as const;
export const report = v.object({
  platform: v.union(...platforms.map(platform => v.literal(platform))),
  status: v.union(...statuses.map(status => v.literal(status))),
  url: v.optional(v.string()),
});
type Report = Infer<typeof report>;
export const recordResult = v.union(v.literal("recorded"), v.literal("ignored"), v.literal("not_found"), v.literal("invalid_url"));

export function parseReport(body: Record<string, unknown>): Report | null {
  const platform = platforms.find(value => value === body.platform);
  const status = statuses.find(value => value === body.status);
  const { url } = body;
  if (!platform || !status) return null;
  if (url === undefined) return { platform, status };
  if (status !== "done" || typeof url !== "string" || url.length > 512) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const expectedPath = { web: "/", api: "/openapi.json", mcp: "/mcp" };
  const valid = platform === "web" || platform === "api" || platform === "mcp"
    ? /^[a-z0-9-]+\.convex\.site$/.test(parsed.hostname) && parsed.pathname === expectedPath[platform]
    : /^(www\.)?appdrop\.app$/.test(parsed.hostname) && /^\/d\/[a-zA-Z0-9]+\/?$/.test(parsed.pathname);
  return valid ? { platform, status, url: parsed.href } : null;
}

function positiveInteger(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function deploymentIdentity(claims: Record<string, unknown>) {
  const { repository, ref, sha, event_name: event } = claims;
  if (typeof repository !== "string" || !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
      typeof ref !== "string" || typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha) ||
      claims.job_workflow_ref !== reusableWorkflow || claims.workflow_ref !== `${repository}/${workflow}@${ref}`) return null;
  const repositoryId = positiveInteger(claims.repository_id);
  const id = positiveInteger(claims.run_id);
  const number = positiveInteger(claims.run_number);
  const attempt = positiveInteger(claims.run_attempt);
  if (!repositoryId || !id || !number || !attempt) return null;
  const pullRequest = event === "pull_request" ? positiveInteger(/^refs\/pull\/([1-9]\d*)\/merge$/.exec(ref)?.[1]) : undefined;
  if (!pullRequest && (event !== "push" || ref !== "refs/heads/main")) return null;
  return { repositoryId, githubOwner: repository.split("/")[0].toLowerCase(), commitSha: sha, run: { id, number, attempt }, pullRequest };
}

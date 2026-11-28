"use node";

import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { env, internalAction } from "../../_generated/server";
import { createDeployKeys, getProject } from "../../apps/actions/convex";
import { githubAppToken, installationToken } from "../../apps/actions/github";
import { previewSecret } from "../../apps/actions/provider";
import { decryptConvexToken } from "../../connections/actions/crypto";

const args = { userId: v.id("users"), appSlug: v.string() };

const githubResult = v.object({ repository: v.string(), token: v.string(), expiresAt: v.number() });
const convexResult = v.object({ deployKey: v.string(), previewName: v.string() });

export const github = internalAction({
  args,
  returns: githubResult,
  handler: async (ctx, { userId, appSlug }): Promise<Infer<typeof githubResult>> => {
    const { app, connection } = await ctx.runQuery(internal.agent.internal.getAppConnection, { userId, appSlug });
    const github = connection?.github;
    if (!github || github.owner.toLowerCase() !== app.githubOwner) {
      throw new ConvexError("Connect the GitHub account that owns this app.");
    }
    const appToken = githubAppToken(env.DISPOSABL_GITHUB_APP_ID, env.DISPOSABL_GITHUB_APP_PRIVATE_KEY);
    const { token, expires_at } = await installationToken(appToken, Number(github.installationId), {
      repositories: [app.githubRepoName],
      permissions: { contents: "write", pull_requests: "write", workflows: "write" },
    });
    return { repository: `${app.githubOwner}/${app.githubRepoName}`, token, expiresAt: Date.parse(expires_at) };
  },
});

export const convex = internalAction({
  args,
  returns: convexResult,
  handler: async (ctx, { userId, appSlug }): Promise<Infer<typeof convexResult>> => {
    const { app, connection } = await ctx.runQuery(internal.agent.internal.getAppConnection, { userId, appSlug });
    if (!connection?.convex) throw new ConvexError("Connect the Convex team that owns this app.");
    const { teamId, accessToken } = connection.convex;
    const token = decryptConvexToken(accessToken, userId, teamId);
    const project = await getProject(token, app.convexProjectId, teamId);
    const previewName = `agent-${app.slug.slice(0, 45)}`;
    const preview = { name: previewName, expiresAt: Date.now() + 60 * 60_000 };
    const deployKey = (await createDeployKeys(token, project, "", [previewSecret], preview)).get(previewSecret);
    if (!deployKey) throw new ConvexError("Convex did not issue a preview deploy key.");
    return { deployKey, previewName };
  },
});

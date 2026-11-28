"use node";

import { createHash } from "node:crypto";
import { ConvexError, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { decryptConvexToken } from "../../connections/actions/crypto";
import { createdApp, createForUserArgs } from "../validators";
import { createDeployKeys, ensureProductionDeployment, ensureProject } from "./convex";
import { ensureRepository, openSecrets } from "./github";
import { previewSecret, productionSecret, ProviderError } from "./provider";
import { ensureSigningSecrets } from "./signing";

export const provision = internalAction({
  args: createForUserArgs,
  returns: createdApp,
  handler: async (ctx, args): Promise<Infer<typeof createdApp>> => {
    const plan = await ctx.runQuery(internal.apps.internal.prepareCreation, args);
    if (plan.status === "complete") return plan.app;

    const { githubOwner, githubInstallationId, convexTeamId, convexAccessToken, appSlug, appName } = plan;
    const identity = JSON.stringify([args.userId, appSlug, appName, githubOwner, convexTeamId]);
    const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 12);
    const resourceName = `${appSlug.slice(0, 48)}-${suffix}`;
    try {
      const token = decryptConvexToken(convexAccessToken, args.userId, convexTeamId);
      const project = await ensureProject(token, convexTeamId, resourceName);
      const production = await ensureProductionDeployment(token, project.id);
      const repository = await ensureRepository(githubOwner, githubInstallationId, resourceName);
      const secrets = await openSecrets(repository);
      await ensureSigningSecrets(token, project.id, production);
      const missingDeployKeys = ([productionSecret, previewSecret] as const).filter(name => !secrets.has(name));
      await secrets.save(await createDeployKeys(token, project, production, missingDeployKeys));
      return await ctx.runMutation(internal.apps.internal.saveCreatedApp, {
        userId: args.userId, appSlug, appName, githubOwner, githubRepoName: resourceName,
        convexProjectId: project.id, convexSiteUrl: `https://${production}.convex.site`,
      });
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      if (error instanceof ProviderError) throw new ConvexError(error.message);
      throw new ConvexError("App creation was interrupted. Retry to resume setup.");
    }
  },
});

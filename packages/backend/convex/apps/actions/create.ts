"use node";

import { ConvexError, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { app, createForUserArgs } from "../validators";
import { createDeployKeys, ensureProductionDeployment, ensureProject } from "./convex";
import { ensureRepository, openSecrets } from "./github";
import { previewSecret, productionSecret, ProviderError } from "./provider";
import { ensureSigningSecrets } from "./signing";

export const provision = internalAction({
  args: createForUserArgs,
  returns: app,
  handler: async (ctx, args): Promise<Infer<typeof app>> => {
    const plan = await ctx.runMutation(internal.apps.internal.beginCreation, args);
    if (plan.status === "complete") return plan.app;

    const { githubOwner, githubInstallationId, convexTeamId, convexAccessToken, resourceName, creationId, leaseId } = plan;
    const lease = { creationId, leaseId };
    try {
      const project = await ensureProject(convexAccessToken, convexTeamId, resourceName);
      const production = await ensureProductionDeployment(convexAccessToken, project.id);
      const repository = await ensureRepository(githubOwner, githubInstallationId, resourceName, creationId);
      const secrets = await openSecrets(repository);
      await ensureSigningSecrets(convexAccessToken, project.id, production, secrets.has);
      const missingDeployKeys = ([productionSecret, previewSecret] as const).filter(name => !secrets.has(name));
      await secrets.save(await createDeployKeys(convexAccessToken, project, production, missingDeployKeys));
      return await ctx.runMutation(internal.apps.internal.finishCreation, { ...lease, convexProjectId: project.id });
    } catch (error) {
      await ctx.runMutation(internal.apps.internal.releaseCreation, lease).catch(() => null);
      if (error instanceof ConvexError) throw error;
      if (error instanceof ProviderError) throw new ConvexError(error.message);
      throw new ConvexError("App creation was interrupted. Retry to resume setup.");
    }
  },
});

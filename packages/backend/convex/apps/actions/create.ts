"use node";

import { ConvexError, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { app, createForUserArgs } from "../validators";
import { createDeployKeys, ensureProject } from "./convex";
import { ensureRepository, openSecrets } from "./github";
import { ProviderError } from "./provider";

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
      const repository = await ensureRepository(githubOwner, githubInstallationId, resourceName, creationId);
      const secrets = await openSecrets(repository);
      await secrets.save(await createDeployKeys(convexAccessToken, project, secrets.missing));
      return await ctx.runMutation(internal.apps.internal.finishCreation, { ...lease, convexProjectId: project.id });
    } catch (error) {
      await ctx.runMutation(internal.apps.internal.releaseCreation, lease).catch(() => null);
      if (error instanceof ConvexError) throw error;
      if (error instanceof ProviderError) throw new ConvexError(error.message);
      throw new ConvexError("App creation was interrupted. Retry to resume setup.");
    }
  },
});

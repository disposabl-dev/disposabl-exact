import { ConvexError } from "convex/values";
import { lookup, productionSecret, request, type DeploySecret } from "./provider";

type Project = { id: number; name: string; slug: string; teamId: number; teamSlug: string };
type Deployment = { name: string; projectId: number; deploymentType: string; kind: string };

export async function ensureProject(token: string, teamId: number, name: string) {
  const { type, teamId: tokenTeamId } = await request<{ type: string; teamId?: number }>("Convex", token, "/token_details");
  if (type !== "teamToken" || tokenTeamId !== teamId) {
    throw new ConvexError("The Convex connection does not match this app's team.");
  }

  const find = async () => {
    const { items } = await request<{ items: Project[] }>(
      "Convex", token, `/teams/${teamId}/projects?q=${encodeURIComponent(name)}`,
    );
    const matches = items.filter(project => project.name === name);
    if (matches.length > 1) throw new ConvexError("Multiple Convex projects match this app.");
    return matches[0];
  };
  let project = await find();
  if (!project) {
    try {
      const created = await request<{ id: number }>(
        "Convex", token, `/teams/${teamId}/create_project`, { projectName: name, deploymentType: "prod" },
      );
      if (!Number.isSafeInteger(created.id) || created.id < 1) {
        throw new ConvexError("Convex did not return a project ID.");
      }
      project = await request<Project>("Convex", token, `/projects/${created.id}`);
    } catch (error) {
      project = await find();
      if (!project) throw error;
    }
  }
  if (project.name !== name || project.teamId !== teamId || !Number.isSafeInteger(project.id) || project.id < 1
    || !/^[a-z0-9_-]+$/.test(project.slug) || !/^[a-z0-9_-]+$/.test(project.teamSlug)) {
    throw new ConvexError("The Convex project does not match this app.");
  }
  return project;
}

async function productionDeployment(token: string, projectId: number) {
  const path = `/projects/${projectId}`;
  const find = () => lookup(request<Deployment>("Convex", token, `${path}/deployment?defaultProd=true`));
  let deployment = await find();
  if (!deployment) {
    try {
      deployment = await request<Deployment>("Convex", token, `${path}/create_deployment`, { type: "prod" });
    } catch (error) {
      deployment = await find();
      if (!deployment) throw error;
    }
  }
  if (deployment.kind !== "cloud" || deployment.deploymentType !== "prod" || deployment.projectId !== projectId
    || !/^[a-z0-9-]+$/.test(deployment.name)) {
    throw new ConvexError("The Convex production deployment does not match this app.");
  }
  return deployment.name;
}

function keyMaterial(token: string) {
  return token.slice(token.lastIndexOf("|") + 1);
}

export async function createDeployKeys(token: string, project: Project, missing: DeploySecret[]) {
  const keys = new Map<DeploySecret, string>();
  if (missing.length === 0) return keys;

  const production = missing.includes(productionSecret) ? await productionDeployment(token, project.id) : null;
  const mint = async (signer: string, name: DeploySecret) => {
    if (name === productionSecret) {
      const { deployKey } = await request<{ deployKey: string }>(
        "Convex", signer, `/deployments/${production}/create_deploy_key`,
        { name: "github-actions-production", allowedActions: ["deployment:deploy", "deployment:env:view", "deployment:env:write"] },
      );
      if (!deployKey.startsWith(`prod:${production}|`) || !keyMaterial(deployKey)) {
        throw new ConvexError("Convex did not return a production deploy key for this app.");
      }
      return deployKey;
    }
    const { previewDeployKey } = await request<{ previewDeployKey: string }>(
      "Convex", signer, `/projects/${project.id}/create_preview_deploy_key`, { name: "github-actions-preview" },
    );
    if (!previewDeployKey.startsWith(`preview:${project.teamSlug}:${project.slug}|`) || !keyMaterial(previewDeployKey)) {
      throw new ConvexError("Convex did not return a preview deploy key for this app.");
    }
    return previewDeployKey;
  };
  let signer = token;
  for (const name of missing) {
    let key = await mint(signer, name);
    // Keys made directly from team OAuth can contain the original team credential.
    if (keyMaterial(key) === keyMaterial(token) && signer === token) {
      const { accessToken } = await request<{ accessToken: string }>(
        "Convex", token, `/teams/${project.teamId}/create_access_token`,
        { name: `Disposabl provisioning: ${project.name}`, expiresAt: Date.now() + 60 * 60 * 1000 },
      );
      signer = accessToken;
      key = await mint(signer, name);
    }
    if (keyMaterial(key) === keyMaterial(token) || keyMaterial(key) === keyMaterial(signer)) {
      throw new ConvexError("Convex returned a team credential. GitHub Actions requires an app-scoped deploy key.");
    }
    keys.set(name, key);
  }
  return keys;
}

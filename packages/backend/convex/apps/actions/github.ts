"use node";

import { createSign } from "node:crypto";
import sodium from "libsodium-wrappers";
import { ConvexError } from "convex/values";
import { env } from "../../_generated/server";
import { lookup, request, type DeploySecret } from "./provider";

type Installation = {
  id: number;
  account: { login: string; type: "Organization" | "User" };
  suspended_at: string | null;
};
type Repository = {
  id: number;
  name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
};

function appToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: env.DISPOSABL_GITHUB_APP_ID,
    iat: now - 60,
    exp: now + 9 * 60,
  })).toString("base64url");
  const data = `${header}.${payload}`;
  const privateKey = env.DISPOSABL_GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!privateKey) throw new ConvexError("GitHub app provisioning is unavailable.");
  return `${data}.${createSign("RSA-SHA256").update(data).sign(privateKey, "base64url")}`;
}

async function installationToken(installationId: number, scope: object) {
  const { token } = await request<{ token: string }>(
    "GitHub", appToken(), `/app/installations/${installationId}/access_tokens`, scope,
  );
  return token;
}

export async function ensureRepository(owner: string, connectionId: string, name: string) {
  const installation = await request<Installation>("GitHub", appToken(), `/app/installations/${connectionId}`);
  if (installation.account?.login.toLowerCase() !== owner || installation.suspended_at
    || !Number.isSafeInteger(installation.id)
    || (installation.account.type !== "Organization" && installation.account.type !== "User")) {
    throw new ConvexError("The GitHub installation does not match this app's owner.");
  }

  const token = await installationToken(installation.id, { permissions: { administration: "write" } });
  const path = `/repos/${owner}/${name}`;
  const description = `Disposabl app ${name}`;
  const find = () => lookup(request<Repository>("GitHub", token, path));
  let repository = await find();
  if (!repository) {
    try {
      repository = await request<Repository>("GitHub", token,
        installation.account.type === "Organization" ? `/orgs/${owner}/repos` : "/user/repos",
        { name, description, private: true, auto_init: false });
    } catch (error) {
      repository = await find();
      if (!repository) throw error;
    }
  }
  if (repository.owner.login.toLowerCase() !== owner || repository.name.toLowerCase() !== name
    || !repository.private || repository.description !== description || !Number.isSafeInteger(repository.id)) {
    throw new ConvexError("The GitHub repository does not match this app.");
  }
  return { repositoryId: repository.id, installationId: installation.id, path };
}

export async function openSecrets(repository: Awaited<ReturnType<typeof ensureRepository>>) {
  const token = await installationToken(repository.installationId, {
    repository_ids: [repository.repositoryId],
    permissions: { secrets: "write" },
  });
  const path = `${repository.path}/actions/secrets`;
  const { secrets } = await request<{ secrets: { name: string }[] }>("GitHub", token, `${path}?per_page=100`);
  const existing = new Set(secrets.map(secret => secret.name));

  return {
    has: (name: string) => existing.has(name),
    async save(values: ReadonlyMap<DeploySecret, string>) {
      if (values.size === 0) return;
      const publicKey = await request<{ key_id: string; key: string }>("GitHub", token, `${path}/public-key`);
      await sodium.ready;
      const encoding = sodium.base64_variants.ORIGINAL;
      const publicBytes = sodium.from_base64(publicKey.key, encoding);
      for (const [name, value] of values) {
        const encrypted = sodium.to_base64(sodium.crypto_box_seal(value, publicBytes), encoding);
        await request<void>("GitHub", token, `${path}/${name}`, {
          key_id: publicKey.key_id, encrypted_value: encrypted,
        }, "PUT");
      }
    },
  };
}

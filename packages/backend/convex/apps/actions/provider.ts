export const productionSecret = "CONVEX_DEPLOY_KEY";
export const previewSecret = "CONVEX_DEPLOY_KEY_PREVIEW";
export type DeploySecret = typeof productionSecret | typeof previewSecret;

const origins = { GitHub: "https://api.github.com", Convex: "https://api.convex.dev/v1" };
type Provider = keyof typeof origins;

export class ProviderError extends Error {
  constructor(provider: Provider, readonly status: number) {
    super(`${provider} could not complete app provisioning (HTTP ${status}).`);
  }
}

export async function request<T>(
  provider: Provider,
  token: string,
  path: string,
  body?: object,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(origins[provider] + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(provider === "GitHub" ? {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ProviderError(provider, response.status);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function lookup<T>(promise: Promise<T>) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) return null;
    throw error;
  }
}

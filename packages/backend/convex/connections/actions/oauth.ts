"use node";

import { createHash, randomBytes } from "node:crypto";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { env, internalAction, type ActionCtx } from "../../_generated/server";
import { request } from "../../apps/actions/provider";
import { callbackArgs, callbackResult, connectLink, githubAccount, githubSelectionArgs, provider, user, type Provider } from "../validators";
import { encryptConvexToken } from "./crypto";

const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const callback = (name: Provider) => new URL(`/dashboard/connections/callback/${name}`, env.CONVEX_SITE_URL).href;

function config(name: Provider) {
  const github = name === "github";
  const clientId = github ? env.GITHUB_OAUTH_CLIENT_ID : env.CONVEX_OAUTH_CLIENT_ID;
  const clientSecret = github ? env.GITHUB_OAUTH_CLIENT_SECRET : env.CONVEX_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || (github ? !env.GITHUB_APP_SLUG || !env.DISPOSABL_GITHUB_APP_ID : !env.CONNECTIONS_ENCRYPTION_KEY)) {
    throw new ConvexError("This connection is not configured yet.");
  }
  return {
    clientId, clientSecret,
    authorize: github ? "https://github.com/login/oauth/authorize" : "https://dashboard.convex.dev/oauth/authorize/team",
    exchange: github ? "https://github.com/login/oauth/access_token" : "https://api.convex.dev/oauth/token",
  };
}

async function authorize(ctx: ActionCtx, userId: Id<"users">, provider: Provider, previousStateHash?: string) {
  const { authorize, clientId } = config(provider);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  await ctx.runMutation(internal.connections.internal.begin, { userId, provider, stateHash: hash(state), verifier, previousStateHash });
  const url = new URL(authorize);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: callback(provider), response_type: "code", state,
    code_challenge: hash(verifier), code_challenge_method: "S256",
  }).toString();
  return { url: url.href };
}

export const start = internalAction({
  args: { ...user, provider },
  returns: connectLink,
  handler: (ctx, { userId, provider }) => authorize(ctx, userId, provider),
});

async function githubPages<T>(read: (query: string) => Promise<T[]>) {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const batch = await read(`per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function githubAccounts(token: string): Promise<Infer<typeof githubAccount>[]> {
  type Installation = {
    id: number;
    app_id: number;
    account: { id: number; login: string; type: string } | null;
    suspended_at: string | null;
    permissions: Record<string, string>;
  };
  const installations = (await githubPages(async query =>
    (await request<{ installations: Installation[] }>("GitHub", token, `/user/installations?${query}`)).installations,
  )).filter(item => item.app_id === Number(env.DISPOSABL_GITHUB_APP_ID) && !item.suspended_at &&
    item.permissions.administration === "write" && item.permissions.secrets === "write");
  if (!installations.length) return [];
  const owner = await request<{ id: number }>("GitHub", token, "/user");
  const members = installations.some(item => item.account?.type === "Organization")
    ? await githubPages(query => request<Array<{ role: string; organization: { id: number } }>>(
      "GitHub", token, `/user/memberships/orgs?state=active&${query}`)) : [];
  const admins = new Set(members.filter(member => member.role === "admin").map(member => member.organization.id));
  return installations.flatMap(({ account, id }) => {
    if (!account || (account.type === "User" ? account.id !== owner.id :
      account.type !== "Organization" || !admins.has(account.id))) return [];
    return [{ owner: account.login, installationId: String(id) }];
  });
}

export const complete = internalAction({
  args: callbackArgs,
  returns: callbackResult,
  handler: async (ctx, { provider, code, state }): Promise<Infer<typeof callbackResult>> => {
    const { clientId, clientSecret, exchange } = config(provider);
    const stateHash = hash(state);
    const { userId, verifier } = await ctx.runMutation(internal.connections.internal.consume, { provider, stateHash });
    const response = await fetch(exchange, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, redirect_uri: callback(provider),
        grant_type: "authorization_code", code, code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new ConvexError("The provider did not authorize this connection.");
    const { access_token: token } = await response.json() as { access_token?: string };
    if (!token) throw new ConvexError("The provider did not authorize this connection.");

    if (provider === "github") {
      const accounts = await githubAccounts(token);
      if (accounts.length === 0) {
        return {
          status: "install",
          installUrl: `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG!)}/installations/new`,
          continueUrl: (await authorize(ctx, userId, provider, stateHash)).url,
        };
      }
      await ctx.runMutation(internal.connections.internal.finishGithub, { stateHash, accounts });
      return accounts.length === 1 ? { status: "connected" } : { status: "choose", accounts };
    }

    const { type, teamId } = await request<{ type: string; teamId: number }>("Convex", token, "/token_details");
    if (type !== "teamToken" || !Number.isSafeInteger(teamId) || teamId < 1) {
      throw new ConvexError("Authorize a Convex team to connect it.");
    }
    await ctx.runMutation(internal.connections.internal.finishConvex, {
      stateHash, account: { teamId, accessToken: encryptConvexToken(token, userId, teamId) },
    });
    return { status: "connected" };
  },
});

export const selectGithub = internalAction({
  args: githubSelectionArgs,
  returns: v.null(),
  handler: (ctx, { state, installationId }): Promise<null> =>
    ctx.runMutation(internal.connections.internal.selectGithub, { stateHash: hash(state), installationId }),
});

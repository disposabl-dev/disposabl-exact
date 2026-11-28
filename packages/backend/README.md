# Convex + TypeScript + ESLint

This template provides a minimal setup to get Convex working, with TypeScript
and ESLint.

See Convex docs at https://docs.convex.dev/home

## Provider connections

The status operations report the signed-in user's connected GitHub owner and Convex team. The connect operations return a provider authorization URL. Open it, complete the provider flow, then read status again. Disconnect removes the saved connection.

- GitHub uses the same GitHub App as app provisioning. Configure `GITHUB_APP_SLUG`, `GITHUB_OAUTH_CLIENT_ID`, and `GITHUB_OAUTH_CLIENT_SECRET`. Register `<CONVEX_SITE_URL>/dashboard/connections/callback/github` as a callback URL. Enable Administration and Secrets write permissions and organization Members read permission.
- Convex uses `CONVEX_OAUTH_CLIENT_ID` and `CONVEX_OAUTH_CLIENT_SECRET`. Register `<CONVEX_SITE_URL>/dashboard/connections/callback/convex` as a redirect URI. Set `CONNECTIONS_ENCRYPTION_KEY` to a base64-encoded 32-byte key to protect saved credentials.

## Setting up

```
npm create convex@latest -t bare
```

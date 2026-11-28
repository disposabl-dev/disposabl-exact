# Convex + TypeScript + ESLint

This template provides a minimal setup to get Convex working, with TypeScript
and ESLint.

See Convex docs at https://docs.convex.dev/home

## Provider connections

The status operations report the signed-in user's connected GitHub owner and Convex team. The connect operations return a provider authorization URL. Open it, complete the provider flow, then read status again. Disconnect removes the saved connection.

- GitHub uses the same GitHub App as app provisioning. Configure `GITHUB_APP_SLUG`, `GITHUB_OAUTH_CLIENT_ID`, and `GITHUB_OAUTH_CLIENT_SECRET`. Register `<CONVEX_SITE_URL>/dashboard/connections/callback/github` as a callback URL. Enable Administration and Secrets write permissions and organization Members read permission.
- Convex uses `CONVEX_OAUTH_CLIENT_ID` and `CONVEX_OAUTH_CLIENT_SECRET`. Register `<CONVEX_SITE_URL>/dashboard/connections/callback/convex` as a redirect URI. Set `CONNECTIONS_ENCRYPTION_KEY` to a base64-encoded 32-byte key to protect saved credentials.

## Deployment status

The generated GitHub Actions workflow reports each platform as building, done, or error. A push to `main` updates `apps.prod`. A pull request from the same repository updates its `pr-<number>` preview. `apps.live` is reserved for store delivery.

Reporting verifies GitHub's OIDC token against the registered repository ID. The last successful URL stays available during a rebuild, after a failure, and after an OTA-only update.

## Setting up

```
npm create convex@latest -t bare
```

## Sending messages to the coding agent

Point the CLI at the Disposabl service to send and read messages.

```sh
export DISPOSABL_API_ORIGIN=https://www.disposabl.dev
bunx disposabl login
bunx disposabl agent sendMessage --prompt "Create a habit tracker"
bunx disposabl agent getMessages --threadId '<threadId>' --paginationOpts '{"numItems":20,"cursor":null}'
bunx disposabl agent sendMessage --threadId '<threadId>' --prompt "Continue setup"
bunx disposabl agent abortMessage --threadId '<threadId>' --messageId '<messageId>'
```

Use `--appSlug` to address an existing app's conversation. Otherwise the first message starts a regular conversation and returns its thread ID. App clients can subscribe to `getMessages` with the Agent component's streaming options. An app created from the conversation inherits its thread.

The generator prints the GitHub connection link first and the Convex link next. The assistant includes the current link in its reply. Open the link wherever you're signed into the provider, then continue the same conversation. Connections are saved on your Disposabl account.

Configure `BOAT_API_KEY` and `BOAT_AGENT_ENVIRONMENT` in the service's Convex deployment. Use a Boat environment marked safe for third parties with proxied AI credentials enabled and a Codex profile with Ultrafast access. The Boat key needs access to read that environment and manage its sandboxes, commands, files, and agent prompts. Set `BOAT_AGENT_SNAPSHOT` to a clean tools image if desired. `BOAT_AGENT_SNAPSHOTS=false` creates a replacement when the previous machine stops. `BOAT_AGENT_MODEL` defaults to `gpt-6.2-sol`. See [Boat AI credentials and proxying](https://docs.boat.dev/ai-credentials).

Each turn gets a temporary Disposabl session. Git and `gh` obtain a GitHub App token for the linked repository. The GitHub App needs Contents, Pull requests, and Workflows write permissions for these operations. Commit and push work to the conversation branch so it can be restored on a replacement machine. From `packages/backend` inside the sandbox, `disposabl-preview` uses a one-hour preview deploy key for that command.

# Create a Disposabl app

Run the Exact starter generator with Node.js 22.12 or newer, Git, and Bun.

```sh
bunx create-disposabl-app@latest my-app
cd my-app
bun run dev
```

The generator installs `@disposabl/cli` and checks your Disposabl sign-in. It then guides you through GitHub and Convex in order. With both providers connected, setup creates the GitHub repository and Convex project in your accounts, sets the repository as `origin`, and saves the returned `appId` in `disposabl.json`. `bun run dev` starts a local Convex development deployment.

The default project enables web, CLI, and authentication. Choose platforms and features at the prompts or pass comma-separated lists for unattended setup.

```sh
bunx create-disposabl-app@latest my-app --platforms web,ios --features authentication,payments
```

The generator saves your selections in `disposabl.json`. Deployment uses the platforms and features in that file. Use `--features ""` for an app without sign-in or billing.

Press Ctrl+C to pause. In a non-interactive shell, open the printed provider link and resume after authorizing. From the generated project's parent directory, run `bunx create-disposabl-app@latest my-app --resume`. Setup skips providers already connected to your Disposabl account. Use `--skip-setup` to generate local files only.

## App CLI

Run `bunx disposabl status` from a generated app. The CLI targets the local Convex deployment when configured, or the app’s hosted API otherwise. Override the target with `--origin <url>`.

Run `bunx disposabl login` if your app uses authentication. `bunx disposabl list` shows the commands exposed by its Convex functions with `platforms: true`. For automation, use `bunx disposabl call <operationId> '<json>'` or run a named command. Apps with payments enabled expose `bunx disposabl billing status`.

## Reset to the clean starter

Run `bun run reset-app` from this package directory in the Exact source checkout to export the clean app and backend to a temporary directory. The command prints the directory path. The package build uses the same reset automatically.

The generator takes `apps/apps`, `packages/backend`, and the backend workspace manifest and lockfile from the commit in [starter.ref](starter.ref). The app's Android Gradle lock and verification metadata come from `apps/apps` in this checkout, shared with the production app and cache fixture. Review and update both when the Android dependency graph changes. Other product files and edits in those directories stay in the Disposabl checkout. To change the starter, commit and push the change on `starter/exact`, then update `starter.ref`. Keep the shared kit and workflows compatible with the pinned starter.

## Release from Exact

Run `bun install --frozen-lockfile` and `bun run test` in this directory to pack and test the starter with its bundled CLI. The **Exact app generator** workflow tests each push to `main` and publishes to npm’s default `latest` tag using the trusted publisher `disposabl-dev/disposabl-exact` and workflow `create-disposabl-app.yml`.

The generator uses `semantic-release` with the Conventional Commits preset. Breaking changes bump the major version, `feat:` bumps the minor version, and other changes bump the patch version. Each release tags the existing commit as `create-disposabl-app-vX.Y.Z`. Tag pushes do not start the branch CI workflows.

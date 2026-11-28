# Create a Disposabl app

Run the Exact starter generator with Node.js 22.12 or newer, Git, and Bun.

```sh
bunx create-disposabl-app@latest my-app
cd my-app
bun run dev
```

The generator installs `@disposabl/cli` as a development dependency in the new app root. Sign in to Disposabl and connect GitHub and Convex when prompted. The CLI provisions a repository, a Convex project with a development deployment, and the GitHub Actions Convex deploy key. The generated checkout has that repository as its `origin` and local Convex settings for its backend and Exact app.

The default project enables web and authentication. Choose platforms and features at the prompts or pass comma-separated lists for unattended setup.

New projects include `disposabl-app` and `disposabl-reconfigure` in `.agents/skills` for Codex and `.claude/skills` for Claude Code.

```sh
bunx create-disposabl-app@latest my-app --platforms web,ios --features authentication,payments
```

The generator saves your selections in `disposabl.json`. The provisioning API uses web to create the repository and Convex project. Deployment uses the platforms and features in the generated file. Use `--features ""` for an app without sign-in or billing.

Run the same command with `--resume` and the app name if setup stops partway. Edit `disposabl.json` to change selections before resuming. Use `--skip-setup` to create the files without provisioning a repository or deployment. Run the project CLI with `bun run disposabl --help`.

## Reset to the clean starter

Run `bun run reset-app` from this package directory in the Exact source checkout to export the clean app and backend to a temporary directory. The command prints the directory path. The package build uses the same reset automatically.

The generator takes `apps/apps`, `packages/backend`, and the backend workspace manifest and lockfile from the commit in [starter.ref](starter.ref). The app's Android Gradle lock and verification metadata come from `apps/apps` in this checkout, shared with the production app and cache fixture. Review and update both when the Android dependency graph changes. Other product files and edits in those directories stay in the Disposabl checkout. To change the starter, commit and push the change on `starter/exact`, then update `starter.ref`. Keep the shared kit and workflows compatible with the pinned starter.

## Release from Exact

Run `bun install --frozen-lockfile` and `bun run test` in this directory to pack and test the starter with the published CLI. The **Exact app generator** workflow tests each push to `main` and publishes to npm’s default `latest` tag using the trusted publisher `disposabl-dev/disposabl-exact` and workflow `create-disposabl-app.yml`.

The generator uses `semantic-release` with the Conventional Commits preset. Breaking changes bump the major version, `feat:` bumps the minor version, and other changes bump the patch version. Each release tags the existing commit as `create-disposabl-app-vX.Y.Z`. Tag pushes do not start the branch CI workflows.

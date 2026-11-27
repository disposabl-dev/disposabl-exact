# Create a Disposabl app

Run the Exact starter generator with Node.js 22.12 or newer, Git, and Bun.

```sh
npx create-disposabl-app my-app
```

npm installs `@disposabl/cli` with the generator. Sign in to Disposabl and connect GitHub and Convex when prompted. The CLI provisions a repository, a Convex project with a development deployment, and the GitHub Actions Convex deploy key. The generated checkout has that repository as its `origin` and local Convex settings for its backend and Exact app.

The default project enables web and authentication. Choose platforms and features at the prompts or pass comma-separated lists for unattended setup.

```sh
npx create-disposabl-app my-app --platforms web,ios --features authentication,payments
```

The generator saves your selections in `disposabl.json`. The provisioning API uses web to create the repository and Convex project. Deployment uses the platforms and features in the generated file. Use `--features ""` for an app without sign-in or billing.

Run the same command with `--resume` and the app name if setup stops partway. Edit `disposabl.json` to change selections before resuming. Use `--skip-setup` to create the files without provisioning a repository or deployment. To run the shared CLI directly, use `npx --package @disposabl/cli disposabl --help`.

## Reset to the clean starter

Run `bun run reset-app` from this package directory in the Exact source checkout to export the clean app and backend to a temporary directory. The command prints the directory path. The package build uses the same reset automatically.

The generator takes `apps/apps`, `packages/backend`, and the backend workspace manifest and lockfile from the commit in [starter.ref](starter.ref). Product files and edits in those directories stay in the Disposabl checkout. To change the starter, commit and push the change on `starter/exact`, then update `starter.ref`. Keep the shared kit and workflows compatible with the pinned starter.

## Release from Exact

Run `bun install --frozen-lockfile` and `bun run test` in this directory to pack the starter and test it with the published CLI. The repository's **Exact app generator** workflow tests each push to `main` and publishes a stable version under npm’s default `latest` tag using npm Trusted Publishing. The workflow adds its run number to the package’s patch version so retries produce the same version. The trusted GitHub publisher is `disposabl-dev/disposabl-exact` with workflow filename `create-disposabl-app.yml`.

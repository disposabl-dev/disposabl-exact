# Create a Disposabl app

Run the Exact starter generator with Node.js 22.12 or newer, Git, and Bun.

```sh
npx create-disposabl-app@next my-app
```

npm installs `@disposabl/cli` with the generator. Sign in to Disposabl and connect GitHub and Convex when prompted. The CLI provisions a repository, a Convex project with a development deployment, and the GitHub Actions Convex deploy key. The generated checkout has that repository as its `origin` and local Convex settings for its backend and Exact app.

Provider setup uses the web platform. The generator enables Android and iOS in the local `disposabl.json` afterward. Follow the generated README for the first web deployment and Exact mobile signing.

Run the same command with `--resume` if setup stops partway. Use `--skip-setup` to create the starter files without provisioning a repository or deployment. To run the shared CLI directly, use `npx --package @disposabl/cli disposabl --help`.

## Reset to the clean starter

Run `bun run reset-app` from this package directory in the Exact source checkout to export the clean app and backend to a temporary directory. The command prints the directory path. The package build uses the same reset automatically.

The generator takes `apps/apps`, `packages/backend`, and the backend workspace manifest and lockfile from the clean commit in [starter.ref](starter.ref). Product files and edits in those directories stay in the Disposabl checkout. To ship an intentional starter change, commit it on a clean starter branch, keep that commit reachable on GitHub, and update `starter.ref`. Keep the shared kit and workflows compatible with the pinned starter.

## Release from Exact

Run `bun install --frozen-lockfile` and `bun run test` in this directory to pack the starter and test it with the published CLI. The repository's **Exact app generator** workflow publishes from `main` when manually dispatched, using a Bun-packed tarball and npm Trusted Publishing for `create-disposabl-app.yml`. It publishes to `next`. After verifying the release, a maintainer can move the npm `latest` tag.

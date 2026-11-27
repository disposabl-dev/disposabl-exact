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

Run `bun install --frozen-lockfile` and `bun run test` in this directory to pack and test the starter with the published CLI. The **Exact app generator** workflow tests each push to `main` and publishes to npm’s default `latest` tag using the trusted publisher `disposabl-dev/disposabl-exact` and workflow `create-disposabl-app.yml`.

The Exact generator starts at `1.0.0`. For subsequent releases, `conventional-recommended-bump` reads the commits since npm’s published revision using the Conventional Commits preset. npm’s `semver` package applies the recommended bump. A Conventional Commit with `!` or a `BREAKING CHANGE:` footer bumps the major version, `feat:` bumps the minor version, and all other changes bump the patch version. Scopes such as `feat(cli):` are supported.

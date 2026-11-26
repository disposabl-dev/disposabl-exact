# Create a Disposabl app

Run the Exact starter generator with Node.js 22.12 or newer, Git, and Bun.

```sh
npx create-disposabl-app@next my-app
```

npm installs `@disposabl/cli` with the generator. Sign in to Disposabl and connect GitHub and Convex when prompted. The CLI provisions a repository, a Convex project with a development deployment, and the GitHub Actions Convex deploy key. The generated checkout has that repository as its `origin` and local Convex settings for its backend and Exact app.

Provider setup uses the web platform. The generator enables Android and iOS in the local `disposabl.json` afterward. Follow the generated README for the first web deployment and Exact mobile signing.

Run the same command with `--resume` if setup stops partway. Use `--skip-setup` to create the starter files without provisioning a repository or deployment. To run the shared CLI directly, use `npx --package @disposabl/cli disposabl --help`.

## Release from Exact

Run `npm ci` and `npm test` in this directory to pack the starter and test it with the published CLI. The repository's **Exact app generator** workflow publishes from `main` when manually dispatched, using npm Trusted Publishing for `create-disposabl-app.yml`. It publishes to `next`. After verifying the release, a maintainer can move the npm `latest` tag.

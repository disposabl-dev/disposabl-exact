# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## First deployment from a new repository

Create a repository from this template and enable GitHub Actions. Use a Convex project with Static Hosting enabled. Configure the following GitHub Actions secrets before the push that starts your first deployment.

| Scope | Name | Value |
| --- | --- | --- |
| Repository | `CONVEX_DEPLOY_KEY` | Convex production deploy key, optional for preview-only repositories |
| Repository | `CONVEX_DEPLOY_KEY_PREVIEW` | Convex project preview deploy key |
| `android-production` environment | `EXACT_UPDATE_SEED` | Independent 32-byte, base64-encoded mobile update signing seed |
| `android-preview` environment | `EXACT_UPDATE_SEED` | Separate preview seed of the same format |
| `android-production` environment | `ANDROID_APK_SIGNING` | JSON containing the base64 PKCS12 `keystore` and its `password`, with key alias `android` |

Create both environments in **Settings → Environments**. Restrict `android-production` to the `main` branch. Both mobile platforms use these environments. Environment secrets are available for public repositories on GitHub Free. [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Same-repository contributors who can edit workflows are trusted with repository secrets. Set the Convex keys at repository scope. A PR uses the preview key. A push to `main` uses the production key when set, or a persistent `main` preview with the preview signing environment when only the preview key is set. To provision the other three secrets, run the following once from your clone with a repository administrator's GitHub CLI login. GitHub-hosted runners generate the keys. The client receives ciphertext encrypted to the environment's GitHub public key and saves it using your existing login. Repeating the command keeps existing keys.

```sh
python3 .github/actions/exact-setup/scripts/setup-signing.py
```

Push one commit to `main`. Even a README edit triggers web deployment and a native build for each mobile platform lacking a compatible baseline. Download the mobile artifacts from **Deploy app**. The iOS job also publishes an unlisted AppDrop install link in its summary. Anyone with that link can access the archive. Complete signing on the iPhone with your own Apple ID through AppDrop/Tuft. Free provisioning needs periodic renewal on the phone, including while the app receives over-the-air updates.

Same-repository PRs deploy to a branch-specific Convex preview and use the preview app variant. Each PR needs its own initial mobile builds because its Convex URL is part of the installed network permissions. Fork PRs do not deploy. The preview APK uses Android's default runner debug certificate with release settings. A later replacement preview APK can require uninstalling the old one if its certificate changes.

## iPhone builds

Blacksmith macOS 27 with Xcode builds the first IPA and any replacement native binary. Blacksmith Ubuntu 26.04 handles web, Android, and compatible iOS updates. The shared iOS setup bundle contains Rust and Hermes tools. Xcode and the Apple SDK come from the hosted runner.

## Subsequent deployments

Web uploads to Convex Static Hosting on every deployment. Android and iOS use Exact's signed update store on AppDrop. Compatible app view, TypeScript and asset changes publish to installed apps. Exact checks on launch or foreground and activates downloaded content on a subsequent cold launch. A native version bump in `apps/apps/app.json`, SDK change, or incompatible permissions or capabilities requires a replacement native build. The workflow uses the actual production bake receipt to initialize each stream.

Only the canonical repository publishes tools. Merge a tools PR into `disposabl-dev/disposabl-exact:main` to publish the version selected in [publish.yml](.github/workflows/publish.yml). Once that release exists, update the deployment pins in a separate PR. Clones download the published bundles on their first deployment and cache them for later runs.

The warm deployment target is one minute including queueing and transfers.

### Android App Bundles and Google Play

Append `--play` to the signing setup command to also create the `ANDROID_PLAY_UPLOAD_SIGNING` environment secret. Set the `ANDROID_PLAY_CONNECTED` Actions **variable** to `true` in `android-production` and bump the app version for the first Play build. Production native builds always produce a signed APK and AAB. By default both use the standalone release key. A Play-connected build signs the AAB with its upload key. If the artifacts have incompatible native receipts, CI keeps the verified APK and fails the job before publishing the AAB. [Play App Signing](https://developer.android.com/studio/publish/app-signing)

### Run the app locally

Install dependencies in `packages/backend`, then run `bun run convex dev` there to link a development backend. In `apps/apps`, run `bun exact.mjs --help` and `bun install`. Set `CONVEX_ORIGIN` in `.env.local` to the development WebSocket URL, for example `wss://your-deployment.convex.cloud`. Start the app with `bun exact.mjs web`. CI derives this value from each Convex deployment. It also supplies the Exact SDK pin, Bun version, build number, update channel and variant. No Apple, App Store Connect, TestFlight, Play Console, or AppDrop credentials belong in Actions for the default workflow.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Planned features

1. Authentication with Google sign-in
2. Payments with Autumn.js on the web and in-app purchases on Android, macOS, and iOS

# Disposabl Exact

Starter kit for building apps and agents with Exact and Convex.

## First deployment from a new repository

Create a repository from this template and enable GitHub Actions. Use a Convex project with Static Hosting enabled. Configure the following GitHub Actions secrets before the push that starts your first deployment.

| Scope | Name | Value |
| --- | --- | --- |
| Repository | `CONVEX_DEPLOY_KEY` | Convex production deploy key |
| Repository | `CONVEX_DEPLOY_KEY_PREVIEW` | Convex project preview deploy key |
| `android-production` environment | `EXACT_UPDATE_SEED` | Independent 32-byte, base64-encoded mobile update signing seed |
| `android-preview` environment | `EXACT_UPDATE_SEED` | Separate preview seed of the same format |
| `android-production` environment | `ANDROID_APK_SIGNING` | JSON containing the base64 PKCS12 `keystore` and its `password`, with key alias `android` |

Create both environments in **Settings → Environments**. Restrict `android-production` to the `main` branch. Both mobile platforms use these environments. Environment secrets are available for public repositories on GitHub Free. [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Set the two Convex secrets yourself. To provision the other three secrets, run the following once from your clone with a repository administrator's GitHub CLI login. GitHub-hosted runners generate the keys. The client receives ciphertext encrypted to the environment's GitHub public key and saves it using your existing login. Repeating the command keeps existing keys.

```sh
gh api -H 'Accept: application/vnd.github.raw+json' \
  'repos/disposabl-dev/exact-setup/contents/scripts/setup-signing.py?ref=a6eaaba8ee6d34839818aa0f8047f4286af61a51' | python3 -
```

Push one commit to `main`. Even a README edit triggers web deployment and a native build for each mobile platform lacking a compatible baseline. Download the mobile artifacts from **Deploy app**. The iOS job also publishes an unlisted AppDrop install link in its summary. Anyone with that link can access the archive. Complete signing on the iPhone with your own Apple ID through AppDrop/Tuft. Free provisioning needs periodic renewal on the phone, including while the app receives over-the-air updates.

Same-repository PRs deploy to a branch-specific Convex preview and use the preview app variant. Each PR needs its own initial mobile builds because its Convex URL is part of the installed network permissions. Fork PRs do not deploy. The preview APK uses Android's default runner debug certificate with release settings. A later replacement preview APK can require uninstalling the old one if its certificate changes.

## iOS on Ubuntu

The public setup release includes the iOS Rust targets and Hermes tools for Ubuntu x64. An iPhone app with no compatible native build also needs the Swift/Darwin cross-toolchain. For organizations with an Ubuntu runner already authorized and provisioned for this SDK, set the repository or organization Actions variable `EXACT_IOS_UBUNTU_RUNNER` to its runner label. The standard GitHub Ubuntu image lacks the iPhone SDK. A missing SDK fails the native iOS job and identifies the missing prerequisite. The web and Android jobs can still complete. [Exact’s Ubuntu build instructions](https://github.com/expo/exact/blob/28f071ca1b04fb4af90af965bab5241fa26d037a/README.md#building-for-ios-on-linux-and-wsl)

Apple’s standard Xcode agreement limits use to Apple-branded hardware running macOS. The public tools release excludes Apple’s SDK. Exact’s hosted build service can return an IPA to an Ubuntu client. Its public API does not document the full build receipt this workflow needs to seed an OTA stream. [Apple’s Xcode agreement](https://www.apple.com/legal/sla/docs/xcode.pdf) · [Exact Build API](https://exact.appdrop.app/docs)

## Subsequent deployments

Web uploads to Convex Static Hosting on every deployment. Android and iOS use Exact's signed update store on AppDrop. Compatible app view, TypeScript and asset changes publish to installed apps. Exact checks on launch or foreground and activates downloaded content on a subsequent cold launch. A native version bump in `apps/apps/app.json`, SDK change, or incompatible permissions or capabilities requires a replacement native build. The workflow uses the actual production bake receipt to initialize each stream.

The shared [Exact setup action](https://github.com/disposabl-dev/exact-setup) downloads pinned platform tools from GitHub Releases. Fresh app repositories can use the same tools. App binaries and signing keys stay specific to each application. Maintainers run **Publish shared Exact tools** in this template to publish a new SDK and Bun combination as a versioned GitHub Release. The shared workflow pins the SDK and Bun. Upgrade the reusable workflow reference in the template to adopt a newer version. Repositories created from that revision use the new tools on their first deployment. Existing repositories keep their pinned versions until their owners upgrade.

The warm deployment target is one minute including queueing and transfers.

### Optional Google Play build

Append `--play` after `python3 -` in the signing setup command to also create the `ANDROID_PLAY_UPLOAD_SIGNING` environment secret. Set the `ANDROID_PLAY_CONNECTED` Actions **variable** to `true` in `android-production` and bump the app version for the first Play build. Production native builds then upload a signed AAB alongside the APK. The Play upload key is separate from the APK signing key. [Play App Signing](https://developer.android.com/studio/publish/app-signing)

### Run the app locally

Install dependencies in `packages/backend`, then run `bun run convex dev` there to link a development backend. In `apps/apps`, run `bun exact.mjs --help` and `bun install`. Set `CONVEX_ORIGIN` in `.env.local` to the development WebSocket URL, for example `wss://your-deployment.convex.cloud`. Start the app with `bun exact.mjs web`. CI derives this value from each Convex deployment. It also supplies the Exact SDK pin, Bun version, build number, update channel and variant. No Apple, App Store Connect, TestFlight, Play Console, or AppDrop credentials belong in Actions for the default workflow.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Planned features

1. Authentication with Google sign-in
2. Payments with Autumn.js on the web and in-app purchases on Android, macOS, and iOS

# Exact setup

Install app-independent tools for a pinned Exact checkout on a clean GitHub-hosted runner:

```yaml
- uses: disposabl-dev/exact-setup@<PINNED_ACTION_COMMIT>
  with:
    platform: web # web, android, or ios
    exact-ref: 28f071ca1b04fb4af90af965bab5241fa26d037a
    bun-version: 1.4.4
```

The action exports `EXACT`; web also exports `EXACT_PUBLISH_TOOLS`, a directory containing the two Linux release publisher executables. Outputs are `exact-path` and `source` (`cache`, `release` or `source`). The shared workflow runs all three jobs on Ubuntu x64. The iOS bundle supplies Rust targets and Hermes. A native iOS build also needs an authorized Swift/Darwin cross-toolchain preinstalled on its Ubuntu runner. The public bundle excludes the Apple SDK. The Linux publisher can deliver compatible iPhone updates using a previously established native baseline. [Exact Linux build prerequisites](https://github.com/expo/exact/blob/28f071ca1b04fb4af90af965bab5241fa26d037a/README.md#building-for-ios-on-linux-and-wsl) Android SDK packages are installed on the consumer runner if missing.

Run **Publish shared Exact tools** in `disposabl-dev/disposabl-exact` with a full Exact SHA and Bun version. It builds three app-independent zstd bundles under 2 GB each and creates a versioned release named for those pins. The default release repository is `disposabl-dev/disposabl-exact`. The consumer caches the downloaded release archive inside its repository. Downloads and cache hits are SHA-256 checked against the accompanying release checksum before extraction. Releases and their checksums must be protected against unauthorized replacement; a checksum from the same release is corruption detection, not independent authenticity. The release name is `v<bundle-version>-exact-<SDK commit>-bun-<Bun version>`. When the tool contents or setup recipe change for the same SDK and Bun versions, increment `bundle-version`, publish a new release, and update the action pin in the template. Existing pins continue selecting their original release and cache key. A missing matching release triggers source setup. A checksum mismatch fails closed.

Bundles contain web kept tools and publisher executables, or the pinned native Rust toolchain, Hermes and Cargo download caches. The action checks out Exact and installs locked dependencies separately. They contain no application checkout, application receipts, signing keys or Apple SDKs. Native builds and a real publisher still require their own credentials and platform-specific setup. This action is not a cache for app build output.

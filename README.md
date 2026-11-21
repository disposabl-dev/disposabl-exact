# Disposabl Exact

Starter kit for building apps and agents.

## Build from this template

Use **Use this template → Create a new repository**. Clone the generated repository, edit the heading in `apps/apps/app.contract`, and push to `main`. The first edit starts parallel web, Android, and iOS builds. Each job restores its platform's compiled starter cache from the canonical repository's [seed release](https://github.com/disposabl-dev/disposabl-exact/releases/tag/exact-seed-v1-f40a26b9). Subsequent pushes restore the generated repository's own Actions cache when available.

Open **Releases** in the generated repository for the commit's `web.zip`, `android.apk`, and `ios-unsigned.ipa`. Extract the web archive onto a static web host. The iOS archive requires signing before installation on a device.

Starter maintainers can publish the three cache archives using **Actions → Publish portable build seeds → Run workflow**.

## Monorepo layout

- `apps/apps` for the Exact app
- `packages/backend` for the Convex backend

## Planned features

1. Authentication with Google sign-in
2. Over-the-air (OTA) updates
3. Payments with Autumn.js on the web and in-app purchases on Android, macOS, and iOS

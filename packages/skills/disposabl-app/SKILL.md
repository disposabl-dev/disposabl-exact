---
name: disposabl-app
description: Create, develop, test, or deliver a Disposabl app generated with Exact and Convex. Use when working on app behavior, setup, or a deployment preview.
---

# Develop a Disposabl app

Read `disposabl.json` for the app's selected platforms and features. Work in the existing project when it has one. For changes to those selections, use the `disposabl-reconfigure` skill.

- When asked to create a project, run `bunx create-disposabl-app@latest my-app` from its parent directory with the requested name and selections. If provider setup stops, resume the same project with `bunx create-disposabl-app@latest my-app --resume`. Use `--skip-setup` for local-only scaffolding.
- Run `bun install` after cloning, then `bun run dev` from the root to start Convex and Exact web. The first Exact build prepares its tools. Use the project's own Convex settings and keep credentials in ignored environment files.
- Read `apps/apps/AGENTS.md` before editing Exact. Define views in `apps/apps/app.contract`, connect data and actions in `apps/apps/app.ts` and its modules, and add user-facing strings to the catalogs in `apps/apps/strings/`. Read `packages/backend/AGENTS.md` before changing Convex functions.
- Verify the affected behavior on the selected targets. From `apps/apps`, use `bun exact.mjs test web` with the configured development backend running. Use `bun run --cwd packages/backend typecheck` from the root for backend changes.
- For an authorized preview, open a same-repository PR to `main` and verify the web app at the resulting preview URL. A push to `main` deploys production through the generated workflow. Check the rendered app and the affected flow before reporting delivery.

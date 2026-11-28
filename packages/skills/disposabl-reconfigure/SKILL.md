---
name: disposabl-reconfigure
description: Enable or disable supported platforms and features in an existing Exact Disposabl app by updating disposabl.json and verifying the affected behavior.
---

# Change platforms and features

Read the root `disposabl.json` and the supported values in `packages/disposabl-kit/server/platform-config.mjs`. Edit only the selections the user wants to change. Keep the app ID, provider settings, and custom code intact.

- Payments require `authentication` and an Autumn configuration on the target Convex deployment. Check the project's README for web billing setup.
- Selecting `cli` or `typescript-sdk` enables the REST API. Check `/openapi.json` and scoped credentials if a change affects developer clients.
- Run `bun test packages/backend/tests/config.test.ts` from the root. Verify the changed behavior locally, including direct routes for any feature that was disabled. The configured deployment applies the new selections when the changes reach `main`.
- Disabling a feature can leave existing records and subscriptions in place. Preserve their data and account access. Coordinate any provider changes separately when the user requests them.

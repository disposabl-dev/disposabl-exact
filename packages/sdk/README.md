# Exact app TypeScript SDK

The build generates types and functions from the app's `/openapi.json`.
Pass the app's HTTP origin and a scoped API key when creating a client.

```ts
import { createClient } from "@disposabl/exact-sdk";

const client = createClient({
  baseUrl: process.env.DISPOSABL_API_ORIGIN,
  auth: process.env.DISPOSABL_API_KEY,
});
```

When payments are enabled at build time, `billingIndexStatus({ client })`
reads billing status for the account that owns the API key.

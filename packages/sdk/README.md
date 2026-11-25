# Exact app TypeScript SDK

The build generates types and functions from the app's `/openapi.json`.
Pass the app's HTTP origin and a scoped API key when creating a client.

```ts
import { counterCurrent, createClient } from "@disposabl/exact-sdk";

const client = createClient({
  baseUrl: process.env.DISPOSABL_API_ORIGIN,
  auth: process.env.DISPOSABL_API_KEY,
});
const { data } = await counterCurrent({ client, throwOnError: true });
```

# Disposabl CLI

Run `bunx disposabl` from a generated app. The CLI uses its local Convex HTTP origin when configured and its hosted API otherwise. Use `--origin <url>` or `DISPOSABL_API_ORIGIN` to choose a target.

| Command | What it does |
| --- | --- |
| `disposabl status` | Reports the current user and whether the app uses authentication. |
| `disposabl login` and `disposabl logout` | Manage the session for an app with authentication enabled. |
| `disposabl list` | Lists the app’s enabled commands and their operation IDs. |
| `disposabl call <operationId> '<json>'` | Invokes an operation with a JSON object. |
| `disposabl billing status` | Reads plan and credits when payments are enabled and an Autumn key is configured. |

Use `disposabl <command> --help` to see the arguments for a function command. Run `disposabl login --no-browser` to print the approval link. For automation, set `DISPOSABL_API_KEY` to a scoped key issued for the target app.

On the Disposabl service, run `disposabl connections status` to check both providers. Run `disposabl connections github` or `disposabl connections convex` followed by `status`, `connect`, or `disconnect`. The `connect` command opens the authorization link. Use `--no-browser` to print it instead.

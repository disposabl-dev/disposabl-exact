# Exact app CLI

Set `DISPOSABL_API_ORIGIN` to the app's HTTP origin and provide its API key as
`DISPOSABL_API_KEY`. Use `exact-app list` to discover operations and
`exact-app call counter_current` to call the starter's demo query. Pass
operation arguments as a JSON object after the operation ID.

With payments enabled, read account billing status with
`exact-app call billing_index_status`. The API key determines which account the
command reads.

# Exact app CLI

Set `DISPOSABL_API_ORIGIN` to the app's HTTP origin and provide its API key as
`DISPOSABL_API_KEY`. Use `exact-app list` to discover operations. Use
`exact-app call <operation-id>` to call one, with arguments as a JSON object.

With payments enabled, read account billing status with
`exact-app call billing_index_status`. The API key determines which account the
command reads.

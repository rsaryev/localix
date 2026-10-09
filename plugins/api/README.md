# API plugin

The API plugin adds a REST client that people and agents can use from the Localix workspace. It
stores named requests as session-owned JSON, resolves environment variables, imports common API
formats, and can explicitly export reviewable request files into a repository.

The bundled plugin is enabled by default. Its tools and workspace surface still follow the active
agent's capability rules; inspect or change them in **Settings → Capabilities → Plugins**.

## Contributions

| Surface          | Contribution                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `api_client`     | Send, save, import, export, and manage requests and environments.            |
| API workbench    | Request tree, editable tabs, response inspection, and saved-request history. |
| Resources/search | Saved requests can be mentioned, searched, and attached as context.          |

The environment menu shares the Requests header; the filter keeps the full sidebar width. Request
and response panes use the shared workbench tabs, toolbars, resize targets, and code editor. Body
editors keep their full height for the document, without pinned scope rows. Pending responses use
the host's loading indicator; a resend leaves the previous response readable while it runs.

## Credentials and environments

A saved request can hold a `${secret:KEY}` reference. The backend resolves that reference from the
Localix credential vault when it sends the request; list, search, export, and context surfaces keep
the reference instead of exposing the value.

Imported literal credentials are moved into the vault when the host supplies its create-only secret
writer. If that safe path is unavailable, the import is refused rather than silently storing the
credential in the request database. Add and rotate credentials in the native **Vault** workspace,
opened directly from the Vault rail item or through **Settings → Capabilities → Secrets → Open
Vault**.

Request environments keep ordinary values such as hosts, API versions, and tenant identifiers in
their file. Rows marked Secret are backed by Localix's native Vault: the file stores only a
`${secret:KEY}` reference, and the value is resolved server-side only for the outgoing request.

## Session storage

Each chat session owns its working collection directly under `.localix/api/` in that session's
resolved workspace. Requests use the typed `*.request.json` suffix, so Localix and the OS can open
them as API requests instead of treating them as arbitrary JSON. Valid legacy `*.json` requests are
migrated on first read. Requests and environments are separate JSON files; the active-environment
pointer lives in the hidden `.localix/api/.state/` folder and is not mixed into a shareable
environment document. The host resolves a session-specific workspace before the plugin constructs
this path. `.localix/` is workspace-local data and should remain ignored by git.

The sidebar's request and environment lists hear changes instead of polling for them: a save by
`api_client` arrives as its `collection_changed` command, and a file under `.localix/api/` rewritten
on disk (by the agent's file tools, a checkout or another editor) through the host's workspace
watcher. Both trigger a refresh. While the workspace watcher is healthy, no polling timer runs. A
visible workbench falls back to a 15-second poll when its watcher is unavailable; initial
subscription, focus, and returning to visibility also reconcile the collection.

Repository sharing is explicit: export writes a portable snapshot under `.localix/rest/`, and a
later import can create a new session's working collection from that snapshot.

## Imports

Import previews first; set `save` only after checking the result.

| Format                | Current boundary                                                             |
| --------------------- | ---------------------------------------------------------------------------- |
| cURL                  | Parses the supported request, auth, body, header, and redirect flags.        |
| OpenAPI 3 / Swagger 2 | Converts documented operations; unsupported auth schemes are reported.       |
| Postman v2            | Imports collections and inherited request auth.                              |
| Postman environment   | Imports variables as a saved environment without activating it.              |
| Insomnia v2–v4        | Imports JSON or YAML request groups, inherited auth, headers, and variables. |
| HAR 1.2               | Imports recorded HTTP requests.                                              |
| Localix request files | Reimports the files produced by the plugin's repository export.              |

Dynamic variables are a supported subset. Unknown or unsupported values remain visible and are
reported instead of being replaced with empty text.

## Repository export

The export action writes one JSON file per request under `.localix/rest/`. Recognized literal
credentials in auth fields, credential headers, and named query parameters block export. This is not
a general secret scanner; review bodies, custom fields, URLs, and metadata before sharing. Vault
references omit the value but can still disclose a meaningful key name.

Set `dir` to a deliberate project-relative export directory such as `api-requests`. Keep the default
`.localix/rest/` as local application state in the Localix repository, where `.localix` is not
committed. The export is a portable snapshot, not a reviewed or automatically published artifact.

## Network boundary

- Private, loopback, and link-local destinations are denied by default.
- `ALLOW_PRIVATE_NETWORK=true` is required when intentionally calling a service on the local or
  private network.
- Redirect destinations are checked again, and authorization is stripped across origins.
- Response bodies are bounded by `MAX_BODY_BYTES`; requests use the configured timeout.
- Redirect cookies exist only for the current send and are not a persistent cookie jar.

The plugin is trusted backend code and can make outbound requests when enabled. Localix permissions
are an application gate, not an operating-system sandbox.

## Configuration

| Key                     | Manifest type | Default     | Effect                                       |
| ----------------------- | ------------- | ----------- | -------------------------------------------- |
| `TIMEOUT_MS`            | String        | `"30000"`   | Per-request timeout in milliseconds.         |
| `MAX_BODY_BYTES`        | String        | `"1000000"` | Maximum response bytes retained by one send. |
| `ALLOW_PRIVATE_NETWORK` | Boolean       | `false`     | Allows private-network targets when enabled. |

## Limits

- GraphQL has no dedicated editor; send a normal JSON HTTP request instead.
- Import compatibility is deliberately narrower than each source application's full model.
- Environment data and saved request metadata are not encrypted by this plugin.
- Git export is an explicit snapshot, not a synchronization engine.

## Source of truth

- [Plugin manifest](./plugin.json)
- [Tool schema](./backend/api-tool-schema.ts)
- [Request routes](./backend/routes.ts)
- [Request sender](./backend/send.ts)
- [Import chain](./backend/import/registry.ts)
- [Repository export](./backend/git-sync/action.ts)
- [Collection synchronization](ui/model/useRequests.ts)
- [Shared file-watcher lifecycle](../../packages/plugin-sdk/src/ui/file-resource-sync.ts)
- [Workspace registration](./ui/register.tsx)

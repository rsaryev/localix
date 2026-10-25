# API mini app

The API mini app adds a REST client that people and agents can use from the Localix workspace. It
stores named requests as workspace-local JSON, resolves environment variables, imports common API
formats, and can explicitly export reviewable request files into a repository.

The bundled mini app is enabled by default. Its tools and workspace surface still follow the active
agent's capability rules; inspect or change them in the Store (**Mini apps**) or the agent's Access
tab.

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
writer. Requests with recognized literal credentials are refused if vaulting fails, while other
items can still save. Imports are not transactional: requests and environments save independently,
and created vault items can remain after a save failure. Review the per-item result. Add and rotate
credentials in the native **Vault** workspace, opened from the Vault rail item.

Request environments keep ordinary values such as hosts, API versions, and tenant identifiers in
their file. Rows marked Secret are backed by Localix's native Vault: the file stores only a
`${secret:KEY}` reference, and the value is resolved server-side only for the outgoing request.

## Collection storage

The working collection lives under `.localix/api/` in the session's resolved working directory.
Sessions using the same directory share requests, environments, and the active-environment service;
a session ID does not create a separate collection folder. Project sessions normally resolve to the
project directory; sessions without a project use the host's session workspace.

Requests use the typed `*.request.json` suffix. Valid legacy `*.json` requests migrate on first
read. Requests and environments are separate files. The active-environment pointer uses a hidden
`.state/` folder for a service first opened with a session, or the mini app state directory for an
unscoped service; services are cached by collection root. `.localix/` is local data and should
remain ignored by git.

Saved-request history is separate: at most ten responses per request, keyed by user and session,
held in backend memory. Restart clears it, and memory pressure can evict older history. It is not a
durable request log.

The sidebar's request and environment lists hear changes instead of polling for them: a save by
`api_client` arrives as its `collection_changed` command, and a file under `.localix/api/` rewritten
on disk (by the agent's file tools, a checkout or another editor) through the host's workspace
watcher. Both trigger a refresh. While the workspace watcher is healthy, no polling timer runs. A
visible workbench falls back to a 15-second poll when its watcher is unavailable; initial
subscription, focus, and returning to visibility also reconcile the collection.

Repository sharing is explicit: export writes a portable snapshot under `.localix/rest/`, and a
later import can populate another working collection from that snapshot.

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
| Localix request files | Reimports the files produced by the mini app's repository export.            |

Dynamic variables are a supported subset. Unknown or unsupported values remain visible and are
reported instead of being replaced with empty text. At send time, `{{name}}` substitution runs once
in URL, headers, query, path parameters, and body. Missing variables block sending. Authentication
fields use native `${secret:KEY}` references directly. Substitution is textual and does not
implicitly escape JSON strings.

### Compatibility details

- cURL imports request fields, not the shell command's complete behavior. Proxy, certificate,
  `--insecure`, retry, timeout, and output options are ignored. File arguments such as `@payload`
  remain text; the importer does not load their bytes.
- OpenAPI and Swagger resolve local `#/...` references. Bundle external references into the document
  before importing. Unsupported authentication can leave a request unauthenticated.
- Postman scripts are not imported. Dynamic `{{$...}}` variables and Insomnia `{% ... %}` template
  tags remain literal text; import warnings identify them, but sending does not evaluate them.
- Recorded or referenced upload filenames do not supply file bytes. Postman file-body uploads are
  omitted with a warning; form fields can retain filenames as text.

## Repository export

The export action writes one JSON file per request under `.localix/rest/`. Recognized literal
credentials in auth fields, credential headers, and named query parameters block export. This is not
a general secret scanner; review bodies, custom fields, URLs, and metadata before sharing. Vault
references omit the value but can still disclose a meaningful key name.

Set `dir` to a deliberate project-relative export directory such as `api-requests`. Keep the default
`.localix/rest/` as local application state in the Localix repository, where `.localix` is not
committed. The export is a portable snapshot, not a reviewed or automatically published artifact.

Export overwrites existing files with the same generated name. It does not remove files for deleted
or renamed requests, export environments, commit changes, or push them. Credential refusals and
filename collisions can produce a partial snapshot; a filesystem error can stop after earlier files
were written. Review the output and remove obsolete files before sharing.

Export directory containment checks path spelling; it does not resolve symlinks. Use a directory
whose actual destination you control.

## Network boundary

- Private, loopback, and link-local destinations are denied by default.
- `ALLOW_PRIVATE_NETWORK=true` is required when intentionally calling a service on the local or
  private network.
- Redirect destinations are checked again. Cross-origin redirects remove `Authorization` and
  `Cookie`, but preserve custom headers and any body retained by the redirect method rules.
- Response bodies are bounded by `MAX_BODY_BYTES`; requests use the configured timeout.
- Redirect cookies exist only for the current send and are not a persistent cookie jar.

The mini app is trusted backend code and can make outbound requests when enabled. Localix
permissions are an application gate, not an operating-system sandbox.

Returned response text, headers, URLs, cookies, and history mask recognized credential values and
resolved Secret environment values using literal and URI-encoded matches. Transformed credentials
and other private response data are outside that matching rule.

The fetch timeout is shared by the redirect chain, with a positive request-level `timeoutMs` taking
precedence. Environment/vault resolution precedes that timer, and destination DNS checks do not
receive its abort signal. The timeout is not a deadline for the complete operation.

## Configuration

| Key                     | Manifest type | Default     | Effect                                       |
| ----------------------- | ------------- | ----------- | -------------------------------------------- |
| `TIMEOUT_MS`            | String        | `"30000"`   | Per-request timeout in milliseconds.         |
| `MAX_BODY_BYTES`        | String        | `"1000000"` | Maximum response bytes retained by one send. |
| `ALLOW_PRIVATE_NETWORK` | Boolean       | `false`     | Allows private-network targets when enabled. |

## Limits

- GraphQL has no dedicated editor; send a normal JSON HTTP request instead.
- Import compatibility is deliberately narrower than each source application's full model.
- Environment data and saved request metadata are not encrypted by this mini app.
- Git export is an explicit snapshot, not a synchronization engine.

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Tool schema](./backend/api-tool-schema.ts)
- [Request routes](./backend/routes.ts)
- [Request sender](./backend/send.ts)
- [Import chain](./backend/import/registry.ts)
- [Repository export](./backend/git-sync/action.ts)
- [Collection scope](./backend/collection/for-scope.ts)
- [In-memory history](./backend/history.ts)
- [Environment rendering](./backend/render-spec.ts)
- [Response masking](./backend/response-redaction.ts)
- [Collection synchronization](ui/model/useRequests.ts)
- [Shared file-watcher lifecycle](../../packages/mini-app-sdk/src/ui/file-resource-sync.ts)
- [Workspace registration](./ui/register.tsx)

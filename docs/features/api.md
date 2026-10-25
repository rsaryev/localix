# Use the API workbench

The bundled API mini app adds a REST client for saved HTTP requests, response inspection, imports,
repository exports, and bounded agent access. Use it when an API workflow should stay visible and
addressable inside the Localix workspace.

**Availability:** The bundled `api` mini app is enabled by default and can be switched off in
**Store → Installed**. Requests to private or local hosts require the app’s **Allow private/internal
hosts** option; enable it only for services you intend to call. Without it, a host whose address
cannot be resolved is refused as well.

![A saved release readiness request with a successful JSON response from the local demo service](../assets/screenshots/api/request-response--2026-10-08.png)

## What you can do

| Capability             | Mechanism                                                                  | Boundary                                                                      |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Build saved requests   | Create named requests with method, URL, headers, authentication, and body  | Request metadata and literal environment values are stored in plaintext       |
| Send and inspect       | Resolve the active environment, send the request, and inspect the response | Response bodies are bounded and each request uses the configured timeout      |
| Import API collections | Preview cURL, OpenAPI, Postman, Insomnia, HAR, or Localix request files    | Compatibility is a supported subset; unsupported values remain visible        |
| Export to a repository | Write reviewable JSON request files under `.localix/rest/`                 | Recognized credential fields block export; review the snapshot before sharing |
| Attach API context     | Search, mention, or attach a saved request as an app-owned resource        | Context keeps supported secret references instead of exposing vault values    |
| Use agent tools        | Manage requests and environments through the app's registered tools        | Tool availability depends on app state, mode, and effective permissions       |

## How it works

The workbench keeps a request tree, editable request tabs, response inspection, and saved-request
history in the workspace. The same saved requests are exposed through the app's search and resource
providers so a session can return to the owning workbench surface.

Before sending, the backend resolves supported environment placeholders and `${secret:KEY}` values.
Secret references are read from the Localix vault only for the operation that needs them. List,
search, export, and context surfaces retain the reference rather than returning the stored value.

Imported literal authentication credentials move into the vault only when the host supplies its
create-only secret writer. Requests that still contain recognized literal credentials are refused;
other items in the same import can save successfully. Saving is not transactional, and created vault
items can remain after a request fails to save. Review the per-item result.

Ordinary environment values are plaintext. Mark credential rows **Secret** to store a vault
reference instead. The active environment supplies `{{name}}` variables in the URL, headers, query,
path parameters, and body; authentication fields use `${secret:KEY}` directly. Missing variables
block sending. Substitution is textual, runs once, and does not automatically escape JSON strings.

### Storage and history

Requests live under `.localix/api/` in the session's resolved working directory, with the
`*.request.json` suffix. Environments are separate files. Sessions that resolve to the same
directory share this collection; a session ID does not create a separate folder. Keep `.localix/`
ignored by git and use export for deliberate sharing.

Saved-request send history keeps at most ten responses per request, scoped by user and session. It
lives in backend memory and disappears on restart; older history can also be evicted under memory
pressure. It is not a durable request log.

### Import support

| Format                | Current boundary                                                              |
| --------------------- | ----------------------------------------------------------------------------- |
| cURL                  | Parses supported request, auth, body, header, and redirect flags              |
| OpenAPI 3 / Swagger 2 | Converts documented operations and reports unsupported authentication         |
| Postman v2            | Imports collections and inherited request authentication                      |
| Postman environment   | Imports variables without activating the saved environment                    |
| Insomnia v2–v4        | Imports JSON or YAML groups, inherited authentication, headers, and variables |
| HAR 1.2               | Imports recorded HTTP requests                                                |
| Localix request files | Reimports the files created by repository export                              |

Unknown dynamic variables remain visible and are reported instead of being replaced with empty text.
Preview an import before saving it.

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

## Network and credential boundary

- Private, loopback, and link-local destinations are denied by default.
- `ALLOW_PRIVATE_NETWORK=true` is required for an intentional local or private-network target.
- Every redirect destination is checked again. Cross-origin redirects remove `Authorization` and
  `Cookie`; custom credential headers and a body preserved by a redirect can still reach that
  origin.
- Redirect cookies live only for the current send; the app has no persistent cookie jar.
- The enabled app is trusted backend code and can make outbound requests.
- Localix permissions are an application gate, not an operating-system sandbox.

## Configuration

| Setting                 | Default     | Effect and boundary                                                   |
| ----------------------- | ----------- | --------------------------------------------------------------------- |
| `TIMEOUT_MS`            | `30000`     | Fetch timeout shared by the redirect chain; a request can override it |
| `MAX_BODY_BYTES`        | `1000000`   | Caps response bytes retained by one send                              |
| `ALLOW_PRIVATE_NETWORK` | `false`     | Allows loopback, private, and link-local targets when on              |
| Credential storage      | Vault field | Use supported authentication fields or `secret:` values               |

A request-specific positive `timeoutMs` overrides the app's default. The fetch timeout covers the
redirect chain; environment/vault resolution occurs before it starts, and destination DNS checks do
not receive its abort signal. It is not a deadline for the complete operation.

Recognized credential values and resolved Secret environment values are masked in returned response
text, headers, URLs, and history. This uses literal and URI-encoded matches, not a general
private-data scanner; transformed credentials or unrelated sensitive response content can remain
visible.

## Limits

- GraphQL has no dedicated editor; send a normal JSON HTTP request instead.
- Import support is narrower than each source application's complete data model.
- Saved request metadata and environment values are not encrypted by the app.
- Repository export does not synchronize later workbench changes.
- A bounded response can omit bytes that were available from the remote server.

For repository sharing, choose a project-relative export folder with `dir`, such as `api-requests`.
The default `.localix/rest/` is local application state and is not committed in the Localix
repository. The exporter checks recognized credential fields, headers, and query names; it does not
scan every body, custom field, URL, or metadata value for private data. Review the complete snapshot
before sharing it.

Export overwrites existing files with the same generated name. It does not remove files for deleted
or renamed requests, export environments, commit changes, or push them. Credential refusals and
filename collisions can produce a partial snapshot; a filesystem error can stop after earlier files
were written. Review the output and remove obsolete files before sharing.

Export directory containment checks path spelling; it does not resolve symlinks. Use a directory
whose actual destination you control.

## Related guides

- [Vault and secrets](secrets.md)
- [Workspace and resource links](workspace.md)
- [Mini apps](../extending/mini-apps.md)

## Source of truth

- [Mini app manifest](https://github.com/rsaryev/localix/blob/main/mini-apps/api/mini-app.json)
- [Tool schema](https://github.com/rsaryev/localix/blob/main/mini-apps/api/backend/api-tool-schema.ts)
- [Request routes](https://github.com/rsaryev/localix/blob/main/mini-apps/api/backend/routes.ts)
- [Request sender and network policy](https://github.com/rsaryev/localix/blob/main/mini-apps/api/backend/send.ts)
- [Import chain](https://github.com/rsaryev/localix/blob/main/mini-apps/api/backend/import/registry.ts)
- [Repository export](https://github.com/rsaryev/localix/blob/main/mini-apps/api/backend/git-sync/action.ts)
- [Workspace registration](https://github.com/rsaryev/localix/blob/main/mini-apps/api/ui/register.tsx)

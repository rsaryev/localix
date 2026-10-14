# Connect MCP servers

Connect Model Context Protocol (MCP) servers to give a primary chat external tools and resources.
Use Settings to scope servers, test connections, and control which tools reach the model.

**Availability:** MCP is omitted from closed child, worker, and automation tool profiles. A server
the scope has not enabled is never connected at all.

## What you can do

| Action                                    | Surface                                                           | Boundary                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Add or edit a server                      | Settings → Capabilities → MCP                                     | The form creates stdio or HTTP records; JSON import also accepts WebSocket records |
| Import server JSON                        | Settings, or the `/mcp` manager                                   | Settings imports disabled records into the selected scope                          |
| Enable, disable, test, or remove a server | Settings                                                          | A test uses the same process-lifetime connection cache as chat                     |
| Enable or disable one advertised tool     | Settings server row after a successful probe                      | Filters apply on the next run; the server keeps its complete cached inventory      |
| Sign in with OAuth                        | Settings on a challenged HTTP server                              | The button appears only after a live probe reports an authentication challenge     |
| List and read resources                   | `mcp_resources` with `list`, `list_templates`, and `read` actions | The tool appears only after a live server advertises the `resources` capability    |

Model-facing tool names use `mcp_<server>_<tool>`. Unsupported characters become underscores, names
stop at 64 characters, and collisions receive a numeric suffix.

## How it works

### Scope and server sources

| Source               | Run behavior                                                      | Boundary                                                           |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| No project registry  | Reads records whose project id is empty                           | Project sessions do not inherit these records                      |
| Project registry     | Reads records for that exact project                              | It does not merge No project records                               |
| Enabled plugin       | Appends the plugin's declared MCP servers to the run              | Disabling the plugin removes its servers                           |
| Seeded `grep` record | Migration adds a No project HTTP record at `https://mcp.grep.app` | It is a normal editable record; project sessions do not inherit it |

Localix does not scan other applications' MCP files. Import is explicit and accepts an `mcpServers`
wrapper, a `servers` wrapper, or a bare name-to-config map in Settings.

### Transports

| Transport | Connection mechanism                                                                 | Authentication boundary                                                  |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `stdio`   | Spawns the configured command in the session working directory and uses stdin/stdout | Inherits the API process environment plus configured variables; no OAuth |
| `http`    | Tries Streamable HTTP, then legacy SSE against the same URL                          | Supports configured headers and OAuth 2.0                                |
| `ws`      | Uses the SDK WebSocket transport                                                     | URL only; configured headers and OAuth are not applied                   |

At connection time, `${VAR}` expands to an environment value or an empty string, while
`${VAR:-default}` uses its default when the variable is unset or empty. Expansion covers command,
arguments, configured environment values, URL, and headers. `CLAUDE_PROJECT_DIR` is set to the
session working directory for expansion and stdio processes.

### Connection and discovery

| State                           | Mechanism                                                                                | Result for the current run                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Persisted metadata exists       | Up to 128 server/config tool lists provide lazy descriptors without starting a transport | The first selected tool reconnects, refreshes the list, and refuses a stale descriptor |
| Optional server has no metadata | Connection and `tools/list` begin during run assembly                                    | Localix waits 1.5 seconds; a slower connection can contribute on a later run           |
| Required server                 | `required: true` keeps startup and discovery on the critical path                        | Any failure aborts run startup and names the failed server                             |
| Live shared client              | Concurrent starts share one promise and later runs reuse the client                      | A close or transport error marks it broken; the next acquire reconnects once           |
| Tool list changed               | `notifications/tools/list_changed` refreshes live and persisted metadata                 | The next gather uses the new inventory without a deliberate reconnect                  |

HTTP cache keys omit the working directory only after configuration expansion. A URL or header that
expands differently through `CLAUDE_PROJECT_DIR` still produces a different key. Stdio cache keys
always include the working directory.

Initial `tools/list` discovery uses up to three attempts for recognized transient network and 5xx
errors. Authentication, 4xx, and timeout failures are not retried. A failed optional server is
omitted from that run and can be tried by a later gather.

A live server can add initialization instructions to the model prompt. Localix trims each server's
instruction text to 2,000 characters; enabling a server therefore trusts both its tools and its
prompt instructions.

### Tools, resources, and output

Accepted MCP tools join the runtime registry and the shared tool-loading policy. Deferred tools
appear in the compact inventory; `activate_tools` adds their full schemas to later model requests.
Their schemas do not all accompany every request. One server can contribute at most 256 tools; each
accepted input schema is at most 128 KiB and each description is at most 600 characters.

The [Tool budget](tool-budget.md) owns the count and estimate behavior. It uses the same cached
names and collision rules as run assembly, and names enabled servers whose tools have not been
probed instead of counting them as zero.

Tool text output defaults to 64,000 characters and at most 128 content parts. A positive
`MAX_MCP_OUTPUT_TOKENS` value changes the text allowance at roughly four characters per token. A
tool's `anthropic/maxResultSizeChars` annotation takes precedence, but cannot raise the host limit
above 256,000 characters.

Tool-call failures return non-fatal errors to the model; Localix does not automatically repeat the
call. Transport failures may be retryable, while a stale lazy descriptor is refused without dispatch
and can require refreshed discovery. Resource listing skips a failed server so another
resource-capable server can still respond.

## Configuration

| Setting                 | Effect                                                            | Default or boundary                          |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `required`              | Makes connection and discovery fail-closed for run startup        | `false`                                      |
| `timeout`               | Per-server tool-call deadline                                     | Values below 1,000 ms are ignored            |
| `MCP_TOOL_TIMEOUT`      | Tool-call deadline when `timeout` is absent or below the floor    | 30,000 ms                                    |
| `MCP_TIMEOUT`           | Connection and capability-discovery deadline                      | 30,000 ms; values below 1,000 ms are ignored |
| `MAX_MCP_OUTPUT_TOKENS` | Changes the default text allowance when no tool annotation exists | Unset                                        |

Per-tool selection is stored as capability rules such as `mcp:<server>/<tool>`, applied when tools
are gathered without rewriting the connection configuration. JSON import translates a non-empty
`enabledTools` list into a family denial followed by named allows, then applies `disabledTools`
denials. An empty allowlist adds no restriction. These legacy import fields are not a separate
runtime filtering mechanism.

HTTP records may include `headers` and an `oauth` object with `clientId`, `clientSecret`, and
`scope`. Without pre-registered client details, the SDK performs discovery, dynamic registration,
PKCE, token exchange, and refresh. Silent runtime connections use stored tokens but never open a
browser.

### Complete an OAuth sign-in

Test the HTTP server first. If the probe reports an authentication challenge and the server has no
stored authorization, its row offers **Sign in**. Open it, approve the provider's consent page, and
keep the same Localix API instance running until the callback finishes. The callback page reports
success or failure; return to Settings and test again to check the live tool inventory. An OAuth
badge alone does not prove that the server's tools are reachable.

A pending sign-in expires after ten minutes and its callback is single-use. Restarting the API loses
pending flows; an expired, reused or failed callback needs a new sign-in attempt. At most 64 flows
are retained across the process, with older entries evicted at the limit. Interactive sign-in uses
Streamable HTTP; the ordinary connection path's legacy SSE fallback is a separate mechanism.

**Sign out** removes the server's locally stored tokens, client registration and PKCE verifier. It
does not call the provider's authorization-revocation endpoint. Revoke access through the provider
when that is required.

OAuth tokens, dynamic client data, and the pending PKCE verifier are AES-256-GCM encrypted under
`~/.localix/mcp-oauth/`. The master key is stored beside that data.

## Limits

- MCP registry scope is exact. Add or import a server in every project that needs it, or contribute
  it through an enabled plugin.
- The Settings form does not create WebSocket records. Use JSON or the API for `ws`; the transport
  cannot send configured headers or use the HTTP OAuth flow.
- The seeded `grep` record belongs to the empty-project registry. Ordinary chats, including Default
  chats, have a project ID and do not gather that record automatically. A Settings probe or a record
  imported into an active project can still contact `mcp.grep.app`.
- MCP does not sandbox a stdio server. Its process runs as the API's OS account, starts in the
  session working directory, and inherits the API process environment.
- Cached metadata is not dispatch authority. A selected lazy tool still reconnects and checks the
  live inventory before dispatch.
- A cold optional server that misses the 1.5-second assembly budget cannot join the run already
  being built; it can appear on a later run.
- Imported configuration is copied into the Localix registry. Later changes to an external
  `.mcp.json` or editor setting have no effect until another import.
- Resource listing rejects a server response that exceeds 100 pages or 10,000 items, or repeats a
  pagination cursor. Listing other servers can continue; this is an error, not a partial inventory.
- Tool annotations are advisory. Missing or contradictory mutation hints use the mutating
  classification, but a consistent `readOnlyHint: true` is trusted rather than independently
  verified.
- OAuth encryption protects the stored payload format, not the same OS account. That account can
  read both the encrypted data and its master key.

## Related guides

- [Tool budget](tool-budget.md)
- [Plugins](../extending/plugins.md)
- [Permission rules](permissions.md)
- [Privacy and network behavior](../getting-started/privacy.md)

## Source of truth

- [Registry contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/contracts.ts)
  and
  [scope repository](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/repository.ts)
- [Import normalization](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/normalize.ts)
- [Imported tool filters as rules](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/imported-tool-rules.ts)
- [Server import and availability](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/service.ts)
- [Deferred tool assembly](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/tool-assembly.ts)
- [Transport connection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-connect.ts)
- [Connection and metadata lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/client-manager.ts)
- [Tool projection and timeouts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-tools.ts)
- [Resource tools](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-resource-tools.ts)
- [Result bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/mcp-result.ts)
- [Runtime assembly](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/mcp-tools.ts)
- [OAuth storage](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/oauth/store.ts)
- [Interactive sign-in and callback](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/oauth/flow.ts)
- [Pending sign-in lifetime](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/oauth/pending-flow-registry.ts)
- [Settings sign-in controls](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/mcpStatus.ts)
- [Default server seed](https://github.com/rsaryev/localix/blob/main/apps/api/migrations/20260601T000000_init_schema.ts)

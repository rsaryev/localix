# Connect MCP servers

Connect Model Context Protocol (MCP) servers to give a primary chat external tools and resources.
Add and configure servers in the Store, test connections there, and use Settings to choose which
servers and tools reach the model.

**Availability:** MCP is omitted from closed child, worker, and automation tool profiles. A child
delegated as a plugin agent type without a `tools` list inherits the chat's MCP tools, and one whose
`tools` names an MCP tool gets that tool. A server the scope has not enabled is never connected at
all.

## What you can do

| Action                                | Surface                                                           | Boundary                                                                              |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Add a server                          | Store → Library → Yours (or Project) → **Add MCP server**         | A program (stdio), a web address (HTTP) or a web socket; the name is chosen once      |
| Change a server's settings            | Its Store page → Settings tab                                     | Command, URL, environment, headers, OAuth client, tool call timeout; saved explicitly |
| Test a connection                     | Its Settings tab → **Test connection**                            | A test uses the same process-lifetime connection cache as chat                        |
| Enable or disable a server            | the Store (MCP servers), or its Store page                        | A rule for the selected agent; a server that is off is never connected                |
| Enable or disable one advertised tool | Its Settings tab, **Tools**, after a successful test              | Filters apply on the next run; the server keeps its complete cached inventory         |
| Sign in with OAuth                    | Its Settings tab → **Sign in**, on an HTTP server                 | Opens the provider's page in your browser; **Sign out** forgets the stored tokens     |
| Remove a server                       | Its Store page                                                    | Removes its record and the secrets kept for it                                        |
| List and read resources               | `mcp_resources` with `list`, `list_templates`, and `read` actions | The tool appears only after a live server advertises the `resources` capability       |

A tool is named `mcp_<server>_<tool>`. Unsupported characters become underscores, names stop at 64
characters, and collisions receive a numeric suffix. Permission rules, tool switches, approvals,
activations, transcripts and usage all use this name.

A plugin's server is offered to the model under Claude Code's name instead,
`mcp__plugin_<plugin>_<server>__<tool>`, so a plugin's skills and commands can call its tools as
written. Only the model sees that name: a call made under it runs as `mcp_<plugin>_<server>_<tool>`,
and a rule written for that name still applies. When Claude Code's name is longer than 64
characters, or another tool of the run already uses it, the model gets
`mcp_<plugin>_<server>_<tool>`.

## How it works

### Scope and server sources

| Source               | Run behavior                                                      | Boundary                                                           |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| No project registry  | Reads records whose project id is empty                           | Project sessions do not inherit these records                      |
| Project registry     | Reads records for that exact project                              | It does not merge No project records                               |
| Enabled plugin       | Appends the plugin's declared MCP servers to the run              | Disabling the plugin removes its servers                           |
| Seeded `grep` record | Migration adds a No project HTTP record at `https://mcp.grep.app` | It is a normal editable record; project sessions do not inherit it |

A run also loads the servers you configured for Claude Code in its folder, read on every run and
never written:

| Claude Code source                                          | In a run                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcpServers` in `~/.claude.json` (user scope)               | Loads in every folder                                                                                                                                                                                |
| `projects["<folder>"].mcpServers` there (local scope)       | Loads in that folder or repository                                                                                                                                                                   |
| `.mcp.json` of the folder or its repository (project scope) | Loads once approved: `enableAllProjectMcpServers` or `enabledMcpjsonServers` in your settings, or in the project's own after you trusted the folder in Claude Code; `disabledMcpjsonServers` rejects |
| `managed-mcp.json` beside the managed settings              | Exclusive: only its servers and `managedMcpServers` load, none of yours or a plugin's                                                                                                                |
| `managedMcpServers` in managed settings                     | Added to the rest, over a server of the same name                                                                                                                                                    |

A name loads once, from the highest of managed, local, project and user; a server you added in
Localix with that name wins over Claude Code's. `deniedMcpServers` and `allowedMcpServers`
(`serverName`, `serverCommand`, `serverUrl`) apply to every server, plugin servers and your own
included. Such a server is offered as `mcp_<server>_<tool>`, like your own. The Store lists the
servers of `~/.claude.json` and the managed settings under Yours, and those of a project's
`.mcp.json` and local entries on its Project shelf, read-only: change them in the file they come
from. Their switch still works. A server a plugin bundles is not listed on its own: it belongs to
the plugin and follows the plugin's switch.

### Transports

| Transport | Connection mechanism                                                                 | Authentication boundary                                                  |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `stdio`   | Spawns the configured command in the session working directory and uses stdin/stdout | Inherits the API process environment plus configured variables; no OAuth |
| `http`    | Tries Streamable HTTP, then legacy SSE against the same URL                          | Supports configured headers and OAuth 2.0                                |
| `ws`      | Uses the SDK WebSocket transport                                                     | URL only; configured headers and OAuth are not applied                   |

At connection time, `${VAR}` expands to an environment value, while `${VAR:-default}` uses its
default when the variable is unset or empty. A `${VAR}` that is unset and has no default stays as
written, as in Claude Code. Expansion covers command, arguments, configured environment values, URL,
and headers. `CLAUDE_PROJECT_DIR` is set to the session working directory for expansion and stdio
processes.

A credential-like name (one containing `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `ACCESS_KEY`,
`PRIVATE_KEY`, `CREDENTIAL` or `AUTH`) reads as empty in a URL or header, set or not and with its
default ignored, so an imported configuration cannot send `ANTHROPIC_API_KEY` or `GITHUB_TOKEN` to
the server it names. Copy the value into a variable with a name of your own to send it on purpose. A
stdio server still receives such names in its command, arguments and environment.

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
above 500,000 characters, Claude Code's own ceiling.

Tool-call failures return non-fatal errors to the model; Localix does not automatically repeat the
call. Transport failures may be retryable, while a stale lazy descriptor is refused without dispatch
and can require refreshed discovery. Resource listing skips a failed server so another
resource-capable server can still respond.

## Configuration

| Setting                             | Effect                                                                                          | Default or boundary                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `required`                          | Makes connection and discovery fail-closed for run startup                                      | `false`                                                                                        |
| `timeout`                           | Per-server tool-call deadline                                                                   | Values below 1,000 ms are ignored                                                              |
| `MCP_TOOL_TIMEOUT`                  | Tool-call deadline when `timeout` is absent or below the floor                                  | 100,000,000 ms (about 28 hours)                                                                |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | Fails a call whose server sends no response and no progress for this long; progress restarts it | 30 minutes for stdio, 5 for HTTP and `ws`; `0` turns it off; a server's `timeout` is its floor |
| `MCP_TIMEOUT`                       | Connection and capability-discovery deadline                                                    | 30,000 ms; values below 1,000 ms are ignored                                                   |
| `MAX_MCP_OUTPUT_TOKENS`             | Changes the default text allowance when no tool annotation exists                               | Unset                                                                                          |

These limits are read from the API's environment and, over it, from the `env` of the Claude Code
settings for the conversation's folder, as Claude Code reads them from its own environment.

Per-tool selection is stored as capability rules such as `mcp:<server>/<tool>`, applied when tools
are gathered without rewriting the connection configuration.

HTTP records may include `headers` and an `oauth` object with `clientId`, `clientSecret`, and
`scope`. Without pre-registered client details, the SDK performs discovery, dynamic registration,
PKCE, token exchange, and refresh. Silent runtime connections use stored tokens but never open a
browser.

### Claude Code's `headersHelper` and `oauth` block

An HTTP or SSE server in a Claude Code file (`.mcp.json`, `~/.claude.json`, managed settings) or a
plugin is read with Claude Code's two extra keys.

`headersHelper` is a shell command that prints a JSON object of headers. It runs on each connection,
with ten seconds, and its headers win a name your static `headers` set. It receives
`CLAUDE_CODE_MCP_SERVER_NAME`, `CLAUDE_CODE_MCP_SERVER_URL` and, for a plugin's server,
`CLAUDE_PLUGIN_ROOT`. When the server answers 401 or 403 the helper runs again and that request is
retried once; nothing is cached, so the script reuses its own token. A helper that prints an
`Authorization` header is the server's authentication: there is no OAuth fallback, and a rejection
is a failed connection rather than a request to sign in. The command starts in the plugin's
directory, in the project directory for a project or local server, and otherwise in `~/.claude`.

A helper is a command, so it runs only with your consent:

- A project `.mcp.json` server must first be approved (the rules above). Its helper also waits for
  the folder to be trusted in Claude Code; until then the server connects with its static headers
  alone. Credential-looking variables (names holding `TOKEN`, `SECRET`, `PASSWORD`, `KEY` or `AUTH`)
  are removed from the helper's environment for a project server and for a plugin's.
- A local or user server is your own file and needs no further step.
- A plugin's helper runs because you enabled the plugin, as its stdio servers do. It cannot
  reference `${user_config.*}`.
- A server in Localix's own registry never runs a helper.

The `oauth` block takes `clientId`, `callbackPort`, `authServerMetadataUrl` and `scopes` (one
space-separated string). A client secret is never read from a file. `scopes` is asked for in place
of what the server advertises, with `offline_access` added when the authorization server lists it.
`authServerMetadataUrl` must be `https://`; it replaces the discovery chain, and without `scopes`
its `scopes_supported` are requested. `callbackPort` makes the redirect
`http://localhost:PORT/callback`: Localix listens there on the loopback addresses only while the
sign-in is pending, and a port that is taken fails the sign-in at once. Localix's own records keep
`scope` for the same setting.

### Complete an OAuth sign-in

Open the HTTP server's page in the Store, choose **Test connection**, then **Sign in**. Approve the
provider's consent page, and keep the same Localix API instance running until the callback finishes.
The callback page reports success or failure; return to the page and test again to check the live
tool inventory. Being signed in does not prove that the server's tools are reachable.

A pending sign-in expires after ten minutes and its callback is single-use. Restarting the API loses
pending flows; an expired, reused or failed callback needs a new sign-in attempt. At most 64 flows
are retained across the process, with older entries evicted at the limit. Interactive sign-in uses
Streamable HTTP; the ordinary connection path's legacy SSE fallback is a separate mechanism.

**Sign out** removes the server's locally stored tokens, client registration and PKCE verifier. It
does not call the provider's authorization-revocation endpoint. Revoke access through the provider
when that is required.

Headers, environment variables and a pre-registered OAuth client secret are not kept in the server's
record: they are sealed in the vault, the Settings tab only says that they are set, and a secret
left out of a save keeps its value. A map you change is replaced whole.

OAuth tokens, dynamic client data, and the pending PKCE verifier are AES-256-GCM encrypted under
`~/.localix/mcp-oauth/`. The master key is stored beside that data.

## Limits

- MCP registry scope is exact. Add a server in every project that needs it, or contribute it through
  an enabled plugin.
- A web socket server cannot send configured headers, run a `headersHelper` or use the HTTP OAuth
  flow.
- The seeded `grep` record belongs to the empty-project registry. Ordinary chats, including Default
  chats, have a project ID and do not gather that record automatically. A test of the record or a
  copy added to an active project can still contact `mcp.grep.app`.
- MCP does not sandbox a stdio server. Its process runs as the API's OS account, starts in the
  session working directory, and inherits the API process environment.
- Cached metadata is not dispatch authority. A selected lazy tool still reconnects and checks the
  live inventory before dispatch.
- A cold optional server that misses the 1.5-second assembly budget cannot join the run already
  being built; it can appear on a later run.
- Claude Code's own files are read live and never written; a server you add in Localix is a separate
  record.
- A `.mcp.json` server that no setting approves does not load: Localix does not show Claude Code's
  approval prompt. Approve it in Claude Code, or list it in `enabledMcpjsonServers`.
- Resource listing rejects a server response that exceeds 100 pages or 10,000 items, or repeats a
  pagination cursor. Listing other servers can continue; this is an error, not a partial inventory.
- Tool annotations are advisory. Missing or contradictory mutation hints use the mutating
  classification, but a consistent `readOnlyHint: true` is trusted rather than independently
  verified.
- OAuth encryption protects the stored payload format, not the same OS account. That account can
  read both the encrypted data and its master key.

## Related guides

- [Tool budget](tool-budget.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Permission rules](permissions.md)
- [Privacy and network behavior](../getting-started/privacy.md)

## Source of truth

- [Registry contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/contracts.ts)
  and
  [scope repository](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/repository.ts)
- [Store provider](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/store-provider.ts),
  [its form](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/store-fields.ts)
  and
  [secrets](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/store-secrets.ts)
- [Server records and availability](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/service.ts)
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
- [Per-agent switches on the agent's Access tab](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/store/ui/AgentAccess.tsx)
- [Default server seed](https://github.com/rsaryev/localix/blob/main/apps/api/migrations/20260601T000000_init_schema.ts)

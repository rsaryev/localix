# Manage the tool budget

The tool budget estimates how many enabled model-facing tools the next agent run can place on model
requests. Narrow the surface with the permission rules in **Settings → Permissions**.

**Effect and coverage:** The report is advisory and changes nothing automatically. MCP servers with
no cached tool inventory are named but not counted.

## What you can do

| Action                        | Mechanism                                                  | Boundary                                                                 |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Check the current surface     | Inspect Settings → Permissions, or ask for `ContextBudget` | Settings shows configured tools; `ContextBudget` estimates schema tokens |
| Remove a tool from later runs | A `tool:<name>` rule with effect `deny` for the agent      | The change applies to the next run; it does not interrupt a running turn |

## How it works

### Surface estimate

The backend report uses the capability snapshot service that also supplies the Tools settings page.
It combines project-level permission filtering, enabled mini app contributions, and cached MCP
inventories. The report is available through `GET /rpc/tools/gc?projectId=<id>`; omit `projectId`
for the no-project scope. The UI does not display a separate tool-budget pill or unused-tool
suggestions. The route accepts `sessionId`, but the current snapshot service does not use it to
resolve an agent. The report is a project-level estimate; use the agent's Tools settings or a run's
`ContextBudget` reading to inspect that agent's surface.

With no MCP server in scope, the estimator removes the MCP resource tools that cannot be assembled.
It then counts the remaining built-in and mini app entries, plus the cached MCP tool entries.

| Count source | Included                                         | Boundary                                                  |
| ------------ | ------------------------------------------------ | --------------------------------------------------------- |
| Built-in     | Enabled core tool names after policy filtering   | Host-dependent assembly can still remove an optional tool |
| Mini app     | Tools contributed by enabled mini apps           | Disabling the owner removes its tools                     |
| MCP          | Post-filter tool names from the connection cache | A server without usable cached metadata is unprobed       |

### Usage evidence

At run start, Localix records the surfaced tool roster. After a tool finishes, it records one call
and whether the result was an error. These best-effort writes use a `tool_usage` row keyed by user,
project scope, and tool name. Agents in the same user/project scope share those counters; the report
does not measure an individual agent's disuse. Calls from tools no longer enabled still contribute
to the scope's 200-call and seven-day evidence gate.

Worker and child-session calls pass through the same completion handler. A tool used only by
delegated work therefore still receives usage credit in the owning project scope.

No suggestion is emitted until the scope has at least 200 recorded calls over at least seven days. A
surfaced tool must also have its own roster row; missing telemetry is not treated as disuse.

| Verdict      | Rule                                          | Precedence                     |
| ------------ | --------------------------------------------- | ------------------------------ |
| Never used   | Available for at least 7 days with zero calls | Evaluated first                |
| Cold         | Last used at least 30 days ago                | Evaluated before error history |
| Always fails | At least 5 calls and every call is an error   | Evaluated last                 |

Each tool receives at most one verdict. Suggestions are ordered by verdict, call count, last-use
time, and name.

The report never suggests disabling `AskUserQuestion`, `Bash`, `Read`, `Search`, `Write`, `Edit`, or
`ToolOutput`.

## Configuration

| Control                   | Scope and value                                 | Effect                                                        |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Built-in or mini app tool | A permission rule in **Settings → Permissions** | Stores a `tool:<name>` rule in that agent's list              |
| MCP tool switch           | **the Store (MCP servers)**; per server         | Updates the server's `enabledTools` or `disabledTools` filter |
| Warning threshold         | Backend `toolBudgetWarn`; default `48`          | Rides the report; no surface renders it today                 |

The Tools page passes the agent whose rules it is showing, so the estimate reflects the rules that
agent's runs are judged by.

## Limits

- The count is explicitly an estimate. Cached MCP state can be incomplete, and the capability
  snapshot cannot predict every host-dependent tool assembled for a run.
- When MCP servers exist but none advertises resources, the estimate can retain the MCP
  resource-tool name `McpResources`. It proves that name absent only when no MCP server is present.
- Usage recording is fire-and-forget and swallows storage errors. Missing writes can delay or
  suppress a suggestion.
- The unused-tool report is served by `GET /rpc/tools/gc` and no surface renders it. A switch and a
  `tool:<name>` rule are the same stored permission rule.
- The report carries warning and hot thresholds, but no surface renders them. They disable, hide,
  defer, group, and truncate nothing: Localix provides no automatic tool-removal mode.
- Disabling a model-facing tool does not remove host-side permission checks, transcript storage, or
  other runtime boundaries that are not tools.

## Related guides

- [MCP](mcp.md)
- [Context checkpoints](context-checkpoints.md)
- [Build a mini app](../extending/mini-apps.md)
- [Capabilities](capabilities.md)

## Source of truth

- [Suggestion rules and thresholds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-gc.ts)
- [Protected tool names](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-policy-sets.ts)
- [Capability and usage report](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/tools/gc-report.ts)
- [Report route and scope](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/tools/routes.ts)
- [Agent-aware capability snapshots](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/snapshot.ts)
- [Wire-count exclusions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/tools/wire-tools.ts)
- [Usage persistence](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/tools/usage-repository.ts)
- [Run roster recording](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/stages/tools.ts)
- [Tool-call recording](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/event-handlers-tools.ts)
- [Per-agent tool switches (Access tab)](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/store/ui/AgentAccess.tsx)

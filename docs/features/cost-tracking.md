# Track model usage and estimated cost

Localix records token usage returned by the active model runtime and estimates USD cost from the
bundled model catalog. Use the composer, `/usage`, and Usage & Spend workbench to inspect a turn,
session, auxiliary calls, or cross-session totals.

## What you can do

| Surface                     | Result                                                       | Boundary                                     |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Composer indicator          | Inspect the latest attempt, context fill, totals, and cache. | A failed attempt can have no provider usage. |
| `/usage`                    | Read visible-turn totals and recorded auxiliary calls.       | The report covers the current session.       |
| **Usage & Spend** workbench | Explore totals, trends, breakdowns, and a request log.       | Data comes from the local usage ledger.      |
| Spend alert                 | Warn after session cost crosses a configured threshold.      | The client-side alert never stops a run.     |

This guide describes the workbench's **Localix** tab. The **External** tab reads separate agent
history; see [External agents](external-agents.md#statistics).

The workbench supports 7-day, 30-day, 90-day, and all-time ranges. Its model, provider, agent, and
session filters apply to summary cards, trends, breakdowns, and the paginated request log. Active
filters are listed as chips under the controls, and each chip removes only its own filter.

Ranges begin an exact number of 24-hour days before the panel opened, rather than at local midnight.
That anchor stays fixed while the panel remains mounted. Seven-day trends use hourly buckets; the
other ranges use daily buckets. Ledger timestamps and trend buckets use UTC.

The Session filter includes that session's own rows, without its children's rows. The separate
backend session-tree filter includes the root and descendants. The request log loads 50 rows at a
time, newest first; changing filters resets it, and scrolling loads older pages.

### Spend per agent

Recorded turns carry the producing agent when that attribution is available, so cost can divide
between agents, including the main agent and its subagents. Group by `Agent` for the breakdown, or
filter by one agent to see everything it spent across every session it took part in.

Background calls a session makes for itself, such as title generation, have no agent and group under
`No agent`. That bucket is shown rather than dropped, so the breakdown still adds up to the total on
the summary card.

## How it works

### Token accounting

The current runtime adapter maps provider response buckets into Localix usage.

```text
inputTokens = uncached input + cache reads + cache writes
totalTokens = inputTokens + outputTokens
```

Localix prices each provider request before summing a tool loop. This keeps long-context tiers tied
to one request's input size instead of the session total.

| Bucket               | Rate used                                           |
| -------------------- | --------------------------------------------------- |
| Uncached input       | Catalog input rate                                  |
| Cache read           | Catalog cache-read rate, or input rate when absent  |
| Standard cache write | Catalog cache-write rate, or input rate when absent |
| One-hour cache write | Twice the catalog input rate                        |
| Output               | Catalog output rate                                 |

### Price source

Runtime estimates use the `cost` fields in the runtime's model catalog, which comes from models.dev,
including its long-context price tiers; OpenRouter's billed cost replaces the estimate when
OpenRouter reports one. The background model-list check keeps it current (see
[Providers](providers.md#how-the-model-list-stays-current)).

Prices, release dates, and reasoning levels all come from that catalog; Localix adds none of its
own. A price change reaches estimates after the next successful check, and an estimate already
recorded is not repriced.

### Cost provenance

| `costSource`   | Meaning                                                       | Current runtime behavior                                  |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| `actual`       | An adapter confirmed a provider-reported billed amount.       | The current message adapter does not set this tag.        |
| `estimated`    | Localix calculated USD from reported usage and catalog rates. | Used for current API-key requests with usage and pricing. |
| `subscription` | Catalog-estimated API-equivalent value for an OAuth request.  | Not metered plan spend or provider billing telemetry.     |

The provider connection store records credential type, not commercial plan type. Estimated chat
turns using OAuth are classified as `subscription`, even when the provider's arrangement is not a
flat subscription. Current auxiliary writers receive usage without that credential-based
classification and default to `estimated`; an OAuth session can therefore contain both sources.

### Persistence and rollups

| Record                  | Purpose                                            | Boundary                                                   |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Assistant message usage | Crash-safe usage for visible turns.                | Present only when the runtime returns usage.               |
| `usage_events` turn row | Cross-session projection of one assistant message. | Written after the message; a failed write can under-count. |
| Boot reconcile          | Re-derives missing or stale turn rows.             | Runs in small pages once the app is idle after launch.     |
| Auxiliary ledger row    | Title, completion, and prompt calls.               | High-frequency calls accumulate by route and kind.         |
| Session usage snapshot  | Visible turns plus non-turn auxiliary ledger rows. | Turn ledger rows are excluded to avoid double-counting.    |

Current auxiliary writers cover session titles, editor next-edit prediction, inline text completion,
and model-based prompt hooks. Agent-based hook verifiers run in child sessions and record ordinary
turns there. Historical prompt-improvement spend remains in its retired kind bucket. Context
checkpoints make no model call, so they add no ledger row; spend recorded under the retired
`compaction` kind folds into turns. Durable ledger writes publish a replacement
`session_usage.updated` snapshot to connected clients.

Repeated auxiliary calls accumulate in one row per session, kind, connection, and model. The request
log and auxiliary counts therefore show recorded buckets, not one row per provider request. An
accumulated row retains its first creation timestamp: later additions appear on that original date,
and a date-range filter can omit new spend added to an older bucket. These aggregates are useful for
session totals but do not provide exact request-by-request daily auxiliary spend.

Boot reconciliation uses persisted assistant-message usage to repair ordinary turn rows. It does not
replay model calls, recover missing auxiliary usage, or reprice history using today's catalog. When
an older message lacks its own model or agent attribution, repair can fall back to the session's
agent; that historical attribution is approximate.

Usage is not attributed to [Kanban](task-board.md) cards. A child session's rows carry the child's
own `session_id`, so the workbench lists it as its own session; a query that bounds a session's work
rolls up the whole tree through `root_session_id`.

## Configuration

| Control                       | Effect                                               | Default or boundary                                  |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| **Preferences → Spend alert** | Store one positive USD threshold in browser storage. | Blank or non-positive disables it.                   |
| Alert dismissal               | Hide the current threshold multiple for one session. | Memory-only; reload clears it.                       |
| Range                         | Select `7d`, `30d`, `90d`, or `All`.                 | `30d` on a newly mounted workbench.                  |
| Grouping                      | Group by `Model`, `Provider`, `Agent`, or `Kind`.    | `Model` on a newly mounted workbench.                |
| Filters                       | Filter by model, provider, agent, and session.       | Kind is a derived breakdown and cannot set a filter. |

Model, provider and agent breakdown rows can set the corresponding filter; the `No agent` row
cannot, since it stands for rows with no agent to filter by. The spend alert reappears at the next
whole multiple of its threshold after dismissal.

## Limits

- Token counts depend on the model runtime returning usage. Localix does not invent missing counts,
  and auxiliary writers skip an empty usage object.
- Most ledger writes are fire-and-forget so accounting cannot fail a model run. A failed write can
  under-count the workbench; visible turn usage remains in the persisted assistant message.
- With the current runtime adapter, USD is a catalog estimate or subscription-equivalent estimate,
  not a provider invoice. The contract supports `actual`, but the adapter does not currently emit
  it.
- Catalog rates can lag provider pricing, routing, discounts, credits, taxes, minimum charges, and
  plan rules. Use the workbench for consumption analysis, not billing reconciliation.
- The spend alert is advisory and client-side. It skips a wholly `subscription` session, but a mixed
  session is summarized as `estimated` and can still trigger the alert.
- `terminal` and `classify` remain accepted ledger kind labels. Current live writers do not record
  terminal completion or permission-classifier calls under those labels.
- A session with more than one cost source is conservatively summarized as `estimated`. Use the
  request log for row-level provenance.

## Related guides

- [Provider connections](providers.md)
- [Context checkpoints](context-checkpoints.md)
- [Forks](delegation.md)
- [Workspace](workspace.md)

## Source of truth

- [Runtime usage and pricing](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/usage.ts)
- [Catalog normalization and release metadata](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/catalog/normalize.ts)
- [Request pricing and cost-source classification](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run-accounting.ts)
- [Turn aggregation and persistence](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/event-handlers.ts)
- [Auxiliary ledger writers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/usage-normalize.ts)
- [Model-based hook accounting](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/cc-hook-evaluators.ts)
- [Usage-kind contract](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/usage/usage-types.ts)
- [Session rollup](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/usage/session-summary.ts)
- [Usage queries and session-tree rollup](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/usage/repository.ts)
- [Sliced startup reconciliation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/usage/reconcile-slices.ts)
- [Usage range calculation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/hooks/usageRange.ts)
- [Usage queries and paging lifecycle](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/hooks/useUsageStats.ts)
- [Usage workbench](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/StatsPanel.tsx)
- [Spend alert policy](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/spendAlert.ts)

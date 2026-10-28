# Research context

Research context is the `Research` tool's search, safe-read, ranking, provenance, and transcript
path. Use this page when changing how web evidence enters a model turn or appears beside an answer.

## Terminology

| Term             | Meaning                                                            | Boundary                                                                   |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Research lane    | A provider-neutral source class selected by `source_types`         | The implemented lanes are web, academic, code, community, and encyclopedia |
| Observation      | One normalized search hit from one query and backend               | A hit is discovery metadata, not evidence read by the model                |
| Candidate        | A canonical URL after deduplication, scoring, and domain filtering | Automatic candidates are capped at two per host                            |
| Consulted source | A page whose bounded content entered the tool result               | Failed reads remain `discovered` with `status: failed`                     |
| `AgentSource`    | Compact provenance stored on a tool-backed transcript item         | The source record does not contain the complete evidence body              |

## What you can do

| Operation                 | Mechanism                                                                   | Boundary                                                                   |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Research a question       | Search focused queries, rank canonical URLs, and read selected pages        | Anonymous backends and target sites can fail independently                 |
| Read known sources        | Pass `urls` without `queries` to skip discovery and read those URLs first   | URLs still pass canonicalization, domain policy, and network-safety checks |
| Select evidence lanes     | Choose web, academic, code, community, or encyclopedia backends             | The caller selects a lane, not a named backend                             |
| Constrain discovery       | Apply include domains, exclude domains, recency, and a source ceiling       | Recency is an adapter hint, not a post-read freshness guarantee            |
| Inspect answer provenance | Open the Sources action for one assistant message in the Activity inspector | Only available consulted or cited sources appear in that answer view       |

## How it works

### Search and read pipeline

```text
research input
  -> lane-matched anonymous backends
  -> normalized observations
  -> canonical URL ranking and domain filters
  -> host-diverse candidate selection
  -> redirect-checked bounded page reads
  -> [S#] evidence content plus AgentSource records
  -> tool-backed transcript item
  -> message-scoped Sources view
```

| Module                                                                                             | Invariant                                                                   | Failure mode                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`research.ts`](../../../apps/api/src/features/agent-core/tools/web/research.ts)                   | One model-facing tool owns discovery and direct URL reads                   | No readable candidate returns an error result with search diagnostics                                    |
| [`research-backends.ts`](../../../apps/api/src/features/agent-core/tools/web/research-backends.ts) | Every backend normalizes into `ResearchSearchHit`                           | A cooldown skips later queries for that backend, not other backends                                      |
| [`research-ranking.ts`](../../../apps/api/src/features/agent-core/tools/web/research-ranking.ts)   | Canonical HTTP(S) URL is the candidate identity                             | Credentials, non-HTTP schemes, and rejected domains never become candidates                              |
| [`research-fetch.ts`](../../../apps/api/src/features/agent-core/tools/web/research-fetch.ts)       | Every redirect hop passes the same network-safety check                     | Blocked, timed-out, PDF, and non-successful reads fail; oversized bodies are capped and marked truncated |
| [`sources.ts`](../../../packages/agent/src/agents/sources.ts)                                      | Source normalization bounds fields and merges repeated `kind + uri` records | Invalid records are dropped; weaker observations cannot downgrade stronger roles                         |
| [`sessionSources.ts`](../../../apps/ui/src/entities/chat/model/sessionSources.ts)                  | Answer sources are derived from the selected message's persisted items      | Discovered and failed records stay off the answer-grade list                                             |

Backends run concurrently up to the configured backend limit. Queries for one backend run in
sequence, allowing its cooldown or required backoff to stop later variants without cancelling other
providers.

Ranking removes URL fragments and known tracking parameters, sorts remaining query parameters, and
adds reciprocal-rank score for each provider/query observation. Explicit URLs sort first. Automatic
selection retains no more than two candidates from one host.

Reads are concurrent across hosts and serialized within one target host. Failed reads leave open
slots for bounded alternates; successful reads stop when `max_sources` is reached. PDF responses
fail as page reads before their bytes enter model evidence, even if a server omits the PDF content
type. The research pipeline can then try the next candidate.

### Evidence and provenance

The result's `content` contains the bounded text replayed to the model. Its `sources` array contains
presentation metadata: URI, title, role, status, provider, retrieval time, and a short snippet.

The shared source contract and persistence path belong to [Context system](context-system.md).
Research adds web-specific records but does not add a second database field or scrape citations from
assistant prose.

`MessageSources` derives answer-grade sources from one assistant message. The action opens that
message's Activity inspector at its Sources section. `collectSessionSources` can derive a
session-wide registry in memory, but the current action does not present that aggregate.

## Configuration

### Model-facing input

| Field             | Default or range                           | Boundary                                                          |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `question`        | Required; 1–2,000 characters               | Anchors the returned evidence packet                              |
| `queries`         | Up to four; each 1–500 characters          | Omission searches `question` unless URL-only mode is used         |
| `urls`            | Up to eight; each at most 4,096 characters | URL-only mode skips search when `queries` is absent               |
| `source_types`    | Default `web`; up to five lane entries     | Runtime selection removes duplicates; values are provider-neutral |
| `include_domains` | Up to ten hosts or URL-shaped values       | Includes matching subdomains                                      |
| `exclude_domains` | Up to ten hosts or URL-shaped values       | A domain in both lists rejects the call                           |
| `recency_days`    | 1–3,650                                    | Translation varies by backend                                     |
| `max_sources`     | Default 5; range 1–8                       | Counts successful evidence reads                                  |

### Runtime defaults

| Control                  | Default           | Effect                                            |
| ------------------------ | ----------------- | ------------------------------------------------- |
| Backend concurrency      | 4                 | Bounds independent adapter runs                   |
| Page-read concurrency    | 3                 | Per-host serialization applies inside this bound  |
| Search timeout           | 30 seconds        | Composes with run cancellation                    |
| Page timeout             | 15 seconds        | Applies to each readable-page load                |
| Search response ceiling  | 1,000,000 bytes   | Caps adapter response acquisition                 |
| Page download ceiling    | 4,000,000 bytes   | Caps each selected source before extraction       |
| Extracted source ceiling | 8,000 characters  | Caps one source in the evidence packet            |
| Total evidence ceiling   | 32,000 characters | Caps all consulted text in one result             |
| `research.allowPrivate`  | `false`           | Allows private/local HTTP(S) targets when enabled |

The user setting is validated in [`contracts.ts`](../../../apps/api/src/features/user/contracts.ts)
and injected into the tool by
[`runtime-tools.ts`](../../../apps/api/src/features/chat/runtime/run/runtime-tools.ts).

## Limits

- Anonymous adapters have independent response formats, shared-IP limits, cooldowns, and service
  availability. The registry does not guarantee that every lane returns results.
- Safe reading extracts bounded HTML, Markdown, JSON, or text. Client-rendered pages, authentication
  walls, paywalls, and non-article markup can yield sparse or failed evidence.
- `research.allowPrivate` lifts the private-address guard for HTTP(S) resources. It does not permit
  non-HTTP schemes or embedded URL credentials. With it off, a host whose address cannot be resolved
  for the guard is refused rather than fetched.
- A discovered title or snippet never becomes consulted evidence by itself. The page read must
  succeed and contribute content.
- The tool can attempt bounded alternates after failures, but it never exceeds eight total read
  attempts or eight successful sources.
- The Sources action is message-scoped. The session-wide collector is library code, not a dedicated
  visible registry.
- Provenance records survive transcript replay, but they cannot reconstruct truncated evidence or a
  source that later changes.

## Related guides

- [Context system](context-system.md)
- [Message bindings](message-bindings.md)
- [Context checkpoints](../../features/context-checkpoints.md)
- [Capabilities and permissions](../../features/capabilities.md)

## Source of truth

- [Research tool and budgets](../../../apps/api/src/features/agent-core/tools/web/research.ts)
- [Anonymous adapter registry](../../../apps/api/src/features/agent-core/tools/web/research-backends.ts)
- [Candidate ranking](../../../apps/api/src/features/agent-core/tools/web/research-ranking.ts)
- [Safe page reader](../../../apps/api/src/features/agent-core/tools/web/research-fetch.ts)
- [Network safety](../../../apps/api/src/features/agent-core/tools/web/net-safety.ts)
- [Shared source contract](../../../packages/agent/src/agents/sources.ts)
- [MCP source normalization](../../../apps/api/src/features/mcp/mcp-result.ts)
- [Message source action](../../../apps/ui/src/entities/chat/ui/MessageSources.tsx)
- [Activity source presentation](../../../apps/ui/src/features/inspector/ui/MessageReplayTab.tsx)

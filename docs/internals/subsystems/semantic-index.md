# Semantic index and local models internals

Use this reference when adding a semantic source, a local model kind, or a consumer of the embedding
engine. The user-facing pages are [Semantic search](../../features/semantic-search.md) and
[Local models](../../features/local-models.md).

## Layers

```text
features/local-models   one runtime, one model router, downloads, catalog       (any model kind)
        ↑                         ↑
features/embeddings      engine → vectors port → reader; engine → ingest/indexer → store/vector cache   (embedding kind)
        ↑                         ↑
features/search          hybrid fusion; SearchQuery.semantic per query           (the strategy)
        ↑                         ↑
providers (chat, plugins)   UI search · agent `global_search` · plugin `host.semantic`
```

Vectors on demand go through one port, `semanticService.vectors` (`semantic-vectors.ts`): the
reader's query vectors, group routing's `rank` and a plugin's `host.semantic.embed`/`rank`. Only the
index's write path (`ingest.ts`) calls the engine itself. The model is named once, in
`embeddings/models.ts`; decision models live beside it in `features/decisions` (`models.ts`).

Each layer names only the one below it. `agent-runtime-pi` sees local chat models through the
`LocalProviderHost` port and knows nothing of the router.

## Module contracts

| Module                                                                                            | Mechanism and invariant                                                                                             | Failure when violated                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`local-models/runtime.ts`](../../../apps/api/src/features/local-models/runtime.ts)               | One pinned llama.cpp build per platform: URL, size, sha256                                                          | A floating build changes model behaviour under the person                          |
| [`local-models/download.ts`](../../../apps/api/src/features/local-models/download.ts)             | Streams to `.part`, hashes while streaming, renames only on a match                                                 | A truncated or tampered file looks installed                                       |
| [`local-models/installer.ts`](../../../apps/api/src/features/local-models/installer.ts)           | Files first, `manifest.json` last; installed = manifest + every file at its size                                    | A half-downloaded model is served                                                  |
| [`local-models/hf-catalog.ts`](../../../apps/api/src/features/local-models/hf-catalog.ts)         | Repo metadata → variants pinned to the commit sha; split models need every shard                                    | A spec points at files that can change                                             |
| [`local-models/router.ts`](../../../apps/api/src/features/local-models/router.ts)                 | One `llama-server --models-preset`; presets rewritten on install/remove, reloaded in place                          | Two processes, or a stale model list                                               |
| [`local-models/stale-server.ts`](../../../apps/api/src/features/local-models/stale-server.ts)     | A recorded router pid is killed only when its command names our presets file                                        | An API killed hard leaves gigabytes resident, or kills a stranger                  |
| [`embeddings/engine.ts`](../../../apps/api/src/features/embeddings/engine.ts)                     | Query lane never waits behind indexing; query vectors LRU-cached; non-finite vectors rejected                       | Typing stalls behind a backfill; NaN reaches the index                             |
| [`embeddings/semantic-vectors.ts`](../../../apps/api/src/features/embeddings/semantic-vectors.ts) | One port for every consumer's vectors; null while search answers from words; symmetric tasks rank on the query lane | A consumer keeps its own cosine or names the model, and a model change rewrites it |
| [`embeddings/ingest.ts`](../../../apps/api/src/features/embeddings/ingest.ts)                     | Content hash per item; unchanged items cost a read; empty text removes                                              | A reconcile re-embeds everything                                                   |
| [`embeddings/indexer.ts`](../../../apps/api/src/features/embeddings/indexer.ts)                   | Reconcile (full scan, prunes unseen keys) then outbox; failures keep work queued                                    | Deleted rows keep vectors; a crash drops changes                                   |
| [`embeddings/vector-cache.ts`](../../../apps/api/src/features/embeddings/vector-cache.ts)         | One float32 matrix per collection and user; appends in place, reloads after replace/remove                          | Results from a vector space the collection left                                    |
| [`embeddings/vectors.ts`](../../../apps/api/src/features/embeddings/vectors.ts)                   | Hub penalty, per-query standardization, population-sized gate                                                       | Generic messages match every query                                                 |
| [`search/hybrid.ts`](../../../apps/api/src/features/search/hybrid.ts)                             | Words and meaning fused; one formula for every provider                                                             | Two providers rank the same item differently                                       |

## Data

| Table                  | Holds                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `semantic_settings`    | Legacy: an index left by the old off switch is compared in full once, then marked on       |
| `semantic_collections` | Per collection: fingerprint (model + width + prompts + source version) and backfill cursor |
| `semantic_items`       | One row per passage: key, chunk, owner, scope, parent, content hash, excerpt, vector       |
| `semantic_outbox`      | Keys changed since embedding, deduplicated                                                 |

Changes arrive through the [change feed](change-feed.md): semantic search is one of its consumers.
Each feature that owns an indexed kind declares a target (`embeddings/targets.ts`): its collection,
an item's key from a notice's ref, and items the change may also have touched (a chat's change
re-reads the message its run finalizes). `upserted` and `deleted` queue the key in the outbox,
`resync` reconciles the collection, and a parent's deletion removes every item stored under it (a
chat's messages name it as their `parent`). Semantic search has no off switch: an index left by the
old one is reconciled in full once at start, which catches what changed while it was off.

| Collection             | Source                                    | Category in the status bar |
| ---------------------- | ----------------------------------------- | -------------------------- |
| `chat.messages`        | `chat/semantic-sources.ts`                | Messages                   |
| `chat.sessions`        | `chat/semantic-sources.ts`                | Chats                      |
| `capabilities.skills`  | `skills-curator/semantic.ts`              | Skills                     |
| `capabilities.plugins` | `plugins/semantic.ts`                     | Plugins                    |
| `capabilities.mcp`     | `mcp/semantic.ts`                         | MCP servers                |
| `agents`               | `agents/semantic.ts`                      | Agents                     |
| `plugin:<name>:<…>`    | a plugin's `host.semantic.registerSource` | the source's `label`       |

Capability catalogs are listed whole for the workspace owner (`embeddings/list-source.ts`): global
items under the scope `global`, each project's own under its id, keyed `<scope>:<name>`. Their
search providers fuse meaning and words through `search/catalog-hybrid.ts`, asking for
`[global, projectId]`.

## Matching

For one query and one collection of `n` passages:

1. `cos_i` — dot product with every stored vector.
2. Hub penalty: `cos_i -= max(0, hub_i - mean(hub))`, where `hub_i` is the passage's similarity to
   the collection centroid. Only a penalty: lifting items far from the centroid would make every
   unusual item match every query in a collection of near-duplicates.
3. `z_i` — standardized against the collection (deviation floor 0.03); collections under 24 items
   use a fixed scale instead.
4. Gate `clamp(√(2·ln n) − 0.5, 2, 3)`: the best of `n` unrelated items already sits near
   `√(2·ln n)`.

Fusion (`search/hybrid.ts`, after DigUp): an item is a candidate when `z ≥ gate` or word coverage
`≥ 0.5`; its score is `max(z, 0) + 2·coverage^1.5`, with meaning halved and words doubled for a
query of only codes and numbers. Measured on a 134-message history: off-topic queries returned
nothing, and the right chat ranked first for every descriptive query tried in Russian and English.

## Adding a semantic source

Register a `SemanticSource` (`@localixai/plugin-sdk/backend`): a collection name, a `label` (its
category in the status bar), a version, and `scan`/`read`. A core kind also gets a target in
[`bootstrap/semantic-changes.ts`](../../../apps/api/src/bootstrap/semantic-changes.ts), and its
writers record changes on the change feed; the map does not compile until every kind of the core
registry has a target or `'ignore'`. A plugin uses `host.semantic`: its collections are namespaced
`plugin:<name>:<collection>`, and `query` returns matches carrying `z` and `gate`.

A search provider receives `query.semantic` only when the hybrid strategy is active. Fuse its
matches with `fuse()` and pass each match's `gate`; without `query.semantic` keep the words-only
path unchanged.

## Adding a local model kind

A kind is a preset section in `router.ts` (`presetSection`) plus a consumer. Chat and embedding
share the downloader, catalog, router and status; a new kind adds only its flags and its consumer.

## Limits

- Vectors are scanned in full per query. Tens of thousands of passages take milliseconds; beyond a
  few hundred thousand an approximate index would be needed.
- The router's reload is best effort: a running instance of a removed model is unloaded by
  `llama-server`, not killed here.
- `stale-server.ts` cannot verify a command line on Windows and therefore leaves the pid alone
  there.

## Source of truth

- [Local models service](../../../apps/api/src/features/local-models/service.ts) ·
  [service.test.ts](../../../apps/api/src/features/local-models/service.test.ts)
- [Semantic service](../../../apps/api/src/features/embeddings/service.ts) ·
  [semantic-pipeline.test.ts](../../../apps/api/src/features/chat/semantic-pipeline.test.ts)
- [Chat sources](../../../apps/api/src/features/chat/semantic-sources.ts) ·
  [hybrid providers](../../../apps/api/src/features/chat/search-provider-hybrid.ts)
- [Local provider](../../../packages/agent-runtime-pi/src/local-provider.ts)
- [Agent tool](../../../apps/api/src/features/agent-core/tools/global-search/global-search.ts)

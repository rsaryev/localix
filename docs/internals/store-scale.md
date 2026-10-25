# Store sources, ranking and search

The Store lists a few thousand packages from several sources: Localix's own, Anthropic's official
and community marketplaces, and later registries. This page is the design for reading those sources,
ranking what they list and searching it by words and by meaning. It extends
[Store design](store.md).

Status: steps 2a and 2b are built ([As built](#as-built)); 2c's screens follow. Sized for about
5,000 listings; the index is SQLite FTS5 from the start.

## Terminology

| Term           | Meaning                                                                | Boundary                                                        |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Default source | A source a fresh profile starts with, from one configuration list.     | Registered for browsing only; nothing from it is installed.     |
| Trust          | `localix`, `official` or `community`, set per source.                  | Sets the badge, the ranking weight and whether a plan is shown. |
| Card fields    | What every listing holds in the index: name, summary, tags, category … | Everything else is fetched when a detail page opens.            |
| Detail fields  | Readme, media, components and the install plan.                        | Fetched on demand, cached by source revision.                   |
| Identity       | A package's origin: repository and path, or registry name.             | Two sources listing one origin show one listing with both.      |
| Store category | One of the Store's fixed categories.                                   | A source's free category is mapped to it, or to Other.          |

## Scale

| Source                    | Listings today | Where packages live                       |
| ------------------------- | -------------- | ----------------------------------------- |
| Localix mini app catalog  | 20             | Archives in the catalog's release         |
| `localix` marketplace     | 1–5            | This repository                           |
| `claude-plugins-official` | 315            | Mostly in the marketplace repository      |
| `claude-community`        | 2,283          | Mostly in their authors' own repositories |

About 2,600 listings today; the design is sized for 5,000 and holds well past 100,000 without a
redesign, because the index is SQLite with FTS5 from the start.

## Index storage

The index is a SQLite database read through `bun:sqlite`, the driver the main database already uses,
with FTS5, which already serves message search. No new dependency, nothing to compile, and the same
engine in the desktop sidecar and in development.

| Choice     | Decision                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File       | Its own file in the cache folder, not the main database: it is derived, so it is not migrated or backed up; a schema version mismatch deletes and rebuilds it.                                                    |
| Access     | Kysely in the Store's repository only (A5); raw SQL only for `MATCH` and `bm25`.                                                                                                                                  |
| Tables     | `listing` (card fields, identity, kind, category, source, trust, static score), `listing_component`, `listing_fts` (FTS5, external content over `listing`), `source_state` (revision, count, synced time, error). |
| Tokenizer  | `unicode61 remove_diacritics 2` with prefix indexes on 2 and 3 characters, so typing matches as you go.                                                                                                           |
| Query text | Sanitized into a `MATCH` expression by the same helper message search uses, moved to a neutral library so the chat and the Store share it (A6).                                                                   |
| Writes     | A source's listings are replaced in one transaction: delete by source, insert in batches; WAL mode, so reads never wait.                                                                                          |
| Facets     | `GROUP BY` over indexed columns of the filtered set; fast enough at this size that no counts table is kept.                                                                                                       |
| Vectors    | Stay in the semantic index (`features/embeddings`); the Store does not store them twice.                                                                                                                          |

Considered and not chosen: an in-memory JavaScript index (Orama, MiniSearch) rebuilds on every start
and holds everything in API memory; a Rust engine (Tantivy) would need a native module or the
desktop shell, and could not run in the plain API. FTS5 is already built into the SQLite Bun ships.

## Default sources

One configuration file lists the sources a fresh profile starts with; adding one is one entry.

| Field       | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `id`        | Stable source id.                                                           |
| `kind`      | Package kind it serves: `mini-app`, `plugin`, later `mcp-server`, `skill`.  |
| `input`     | What the provider's add takes: a catalog URL, `owner/repo`, a registry URL. |
| `trust`     | `localix`, `official` or `community`.                                       |
| `weight`    | Ranking factor: `localix` 1.0, `official` 0.7, `community` 0.35 by default. |
| `editorial` | Whether its collections and featured flags may reach Discover.              |

Starting entries: the Localix mini app catalog and the `localix` marketplace (`localix`, editorial),
`anthropics/claude-plugins-official` (`official`, editorial) and
`anthropics/claude-plugins-community` (`community`, not editorial).

A default source is registered without installing or enabling anything. One the person removes is
remembered and not added back, as the `localix` marketplace already is. A source the person adds
themselves is `community` with the community weight unless it is on the default list.

## Sync

| Stage    | What happens                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------- |
| When     | At start when older than six hours, every six hours after, and when a person presses Update.         |
| Fetch    | The provider refreshes its source as today (git pull or a conditional download); unchanged is cheap. |
| Read     | The provider lists card fields from the source's own file; it never clones a package to list it.     |
| Index    | The Store replaces that source's listings in one swap and records its revision and count.            |
| Announce | One `store` poke and one `resync` of the Store's semantic collection.                                |

A remote plugin's components, size and readme are unknown until its detail page is opened. Opening
it fetches the plugin shallowly into the plugin cache (which an install then reuses), reads its
components and writes them back to the index, so capability shelves fill in as people browse.

## Identity and duplicates

A listing's identity is its origin, normalized: a git URL without `.git` and with its path and
revision, an npm name, or a catalog archive's name. When two sources list one identity, the Store
shows one card under the highest-weight source and lists the others as "Also in" on its detail page.
Installing uses the source the person picked, the highest-weight one by default.

## Categories

The Store has fixed categories: Development, Data, Content, Productivity, Design, Security,
Operations, Learning, Games, Utilities, Other.

- A mini app's category and a marketplace's `category` map through one table (for example `database`
  → Data, `deployment` and `monitoring` → Operations, `testing` → Development).
- A listing without a category is placed by its tags, keywords and summary against each category's
  keyword list.
- When nothing matches, it goes to Other; it is never guessed by a model.

## Ranking

A listing's static score is computed when its source is indexed:

```text
static = trustWeight × (1 + 0.5·featured + 0.3·recommended + 0.2·freshness) × quality
```

- `freshness` falls from 1 to 0 over a year since the listing's version last changed.
- `quality` is 1 for a listing with a description, a category and an icon or tags, and down to 0.6
  for one with a name only, so empty entries sink without being hidden.
- A match with the open project (languages and tools found in its files) adds a boost at query time,
  so a TypeScript project sees its LSP and reviewers first.

Discover rows, shelves and "See all" order by this score. A search orders by relevance first and
uses the score to break near ties.

## Search

The Store's search is the same hybrid search Localix already runs for chats and capabilities: words
and meaning fused (`features/search/hybrid.ts`).

| Part     | How                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Words    | FTS5 `MATCH` with BM25, name and display name weighted above tags, summary and component names; prefix on the last word while typing.     |
| Meaning  | Each listing is a row of its own semantic collection: title, summary, tags, category and component names, embedded by the built-in model. |
| Fusion   | The shared `fuse` puts both on one scale, as `catalogHits` does; a meaning match counts only when it stands out from the collection.      |
| Ranking  | Relevance first, then the static score; trust weight keeps a Localix package above an equal community one.                                |
| Fallback | While the model downloads or is unavailable, search answers from words and says so.                                                       |

The collection is fed by a list source over the Store index. Unchanged listings cost a hash compare
in the indexer, so a sync re-embeds only what changed. The first full embed of about 2,600 short
texts runs once in the background; until a listing is embedded it is found by its words. The vector
matrix for 5,000 listings at 256 dimensions is about 5 MB, scanned in well under a millisecond.

The Store collection is separate from the installed-capabilities collections, so searching the Store
never crowds the palette's search for an installed skill, and the reverse.

### One search, two places

The Store adds no search engine of its own. It registers one provider, `store`, in the global
search-provider registry (`@localixai/mini-app-sdk/backend`), the way chats, files and installed
plugins do, and both places ask the global search service:

| Place                    | Request                                                     | Shows                                                                                        |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The search palette       | Every eager provider, `store` among them, five hits at most | A "Store" group below installed results: packages not yet installed; Enter opens their page. |
| The Store's search field | `domains: ['store']` plus the Store's filters               | Full results in pages, with facets; the same ranking as the palette.                         |

The global service builds the query's semantic strategy once (the query embedded once) and hands it
to every provider. The `store` provider takes word candidates from FTS5 (BM25 over the filtered
index) and meaning candidates from its semantic collection, and fuses them with the shared `fuse`
from `features/search/hybrid.ts`, the step `catalogHits` uses, so a Store hit and a skill hit are
scored on the same scale. The Store's filters travel as a provider option on the query, so the
shared `SearchQuery` gains one optional, opaque field rather than Store-specific ones. The Store
routes reach the search service through a port wired in `bootstrap/` (A4), never by importing the
search feature.

## Query path

1. Filters (shelf, kind, category, source, trust, installed, updates) narrow by indexed columns.
2. A query goes through the global search service to the `store` provider, which runs the hybrid
   search over what is left; with no query, the Store orders by score without calling search.
3. Results come back in pages of 40 with a cursor; facet counts are counted over the filtered set.
4. Typing debounces at 150 ms and cancels the previous request.

## Budgets

| Measure                                              | Budget                    |
| ---------------------------------------------------- | ------------------------- |
| Open the Store to first cards                        | 150 ms                    |
| Search over 5,000 listings, p95, with meaning        | 60 ms                     |
| Next page while scrolling, p95                       | 20 ms                     |
| Re-index one 2,300-entry marketplace                 | 1 s, off the request path |
| Store index in API memory (beyond SQLite page cache) | 5 MB                      |

Each budget has a benchmark test over a generated index of 5,000 and 20,000 listings.

## Order of work

| Step  | Delivers                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a    | Default sources list with trust and weight; plugins provider listing card fields; identities.                                                      |
| 2b    | SQLite FTS5 index, categories, static score, keyset pages with facets, Store semantic collection, hybrid search through the global search service. |
| 2c    | Discover from editorial picks and computed rows; lazy detail and components; adaptive UI.                                                          |
| Later | Federated registries (MCP Registry) with their own search.                                                                                         |

## Limits

- Ratings, install counts and popularity need a server Localix does not run; ranking uses trust,
  editorial flags, completeness, freshness and the open project only.
- A community plugin's components are unknown until its detail page has been opened once.
- Search by meaning needs the built-in embedding model; until it is ready, search is by words.

## As built

Where the build differs from the design above, or settles what it left open:

- **Default sources** are `DEFAULT_SOURCES` in `packages/store/src/default-sources.ts`, a typed
  module rather than a JSON file, because the API, the UI and both providers import it. The
  community marketplace's id is its catalog name, `claude-community`. A default marketplace already
  registered from the same repository under any name is reused; Localix does not read Claude Code's
  own `known_marketplaces.json` for it. Removals are remembered in `.defaults.json` in the
  marketplaces root (an earlier `.official.json` still counts for `localix`).
- **Sync** runs off the request path: a provider's or a relayed notice's word marks the index dirty
  and a background sync writes it, then pokes `store`; only a first read of an empty index waits. A
  plugin notice now pokes `store`. The sources are fetched again every six hours on the plugin
  pass's clock (first a random one to ten minutes after start), not "at start when older than six
  hours".
- **Index**: the person's installs, jobs and settings link live in `listing_state` beside the cards,
  so a job's progress rewrites a few rows, not a source. A source is rewritten only when its cards'
  hash changes. Components learned from a fetched package outlive a replace while the source still
  says `unknown`. Columns `publisher` and `updated_at` serve Discover. Schema version 2.
- **Identity**: a git origin keeps a branch or tag but not a pinned commit, and `main`, `master` and
  `HEAD` count as the repository itself; otherwise the official and community copies of one
  repository, pinned to different commits, would not meet. On today's marketplaces 226 of 2,598
  entries are copies.
- **Ranking in search**: the static score decides 15% of a hit's score, enough for near ties only.
  Words found in the name count once more, and a name that is exactly the query (`code-review` for
  "code review") as much as a strong match by meaning: measured on the real marketplaces, coverage
  alone let a summary mention outrank a package named for the query.
- **Sources' state**: `source_state`'s synced time and error reach the Sources screen through
  `SourceView.syncedAt` and `problem` (`features/store/sources.ts`); a source the provider could not
  read says so there and on the listings page's `problems`.
- **Search pages** come from the global search service's offset cursor over at most 200 hits (its
  scoped provider cap); browsing pages are keyset.
- **The palette** shows the `store` group last, at most five packages not installed.
- **Project boost**: the open project's words come from its root's file names and its `package.json`
  dependencies (`project-signals.ts`); nothing else in Localix detected a project's languages. A
  word lifts a listing by a quarter, two at most.

### Measured

On a development machine against the real marketplaces (315 official and 2,283 community entries;
the hosted mini app catalog answered 404 and the `localix` marketplace has no catalog on GitHub
yet):

| Measure                                             | Measured                                                 |
| --------------------------------------------------- | -------------------------------------------------------- |
| Plugins provider listing, cold / warm               | 63 ms / 13 ms                                            |
| First index of both marketplaces / unchanged sync   | 154 ms / 29 ms                                           |
| Index file                                          | 9.0 MB                                                   |
| First page after a restart / warm / next page       | 4–15 ms / 3–7 ms / 3–4 ms                                |
| Search p50 / p95 with meaning, through the HTTP API | 5–11 ms / 6–13 ms (first query 1.5 s: the model loading) |

The budgets' tests (`budgets.integration.test.ts`, run with `bun run test:integration`, never in the
unit suite: wall-clock budgets on a shared CI runner under coverage measure the runner) generate
5,000 and 20,000 listings: first page 3.5 / 14 ms, search p95 9 / 22 ms, next page 0.7 / 1.6 ms,
re-indexing a 2,300-entry source well under a second.

## Related guides

- [Store design](store.md)
- [Semantic search](../features/semantic-search.md)
- [Architecture rules](architecture/README.md)

## Source of truth

- [Hybrid catalog search](../../apps/api/src/features/search/catalog-hybrid.ts)
- [Catalog semantic source](../../apps/api/src/features/embeddings/list-source.ts)
- [Plugin marketplace schema](../../apps/api/src/features/plugins/marketplace.ts)
- [Store index](../../apps/api/src/features/store/index-repository.ts) and
  [its schema](../../apps/api/src/features/store/index-repository-open.ts)
- [Store search provider](../../apps/api/src/features/store/search-provider.ts)
- [Default sources](../../packages/store/src/default-sources.ts) and
  [categories](../../packages/store/src/categories.ts)

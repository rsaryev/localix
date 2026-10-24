# Store sources, ranking and search

The Store lists a few thousand packages from several sources: Localix's own, Anthropic's official
and community marketplaces, and later registries. This page is the design for reading those sources,
ranking what they list and searching it by words and by meaning. It extends
[Store design](store.md).

Status: proposed. Sized for about 5,000 listings, with headroom to 20,000.

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

About 2,600 listings today; the design holds to 20,000. At that size the whole index is a few
megabytes in memory and every query is a scan, so there is no separate database. Past roughly 50,000
listings the index moves to SQLite FTS5 behind the same Store port; nothing above it changes.

## Default sources

One configuration file lists the sources a fresh profile starts with; adding one is one entry.

| Field       | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `id`        | Stable source id.                                                           |
| `kind`      | Package kind it serves: `mini-app`, `plugin`, later `mcp-server`, `skill`.  |
| `input`     | What the provider's add takes: a catalog URL, `owner/repo`, a registry URL. |
| `trust`     | `localix`, `official` or `community`.                                       |
| `weight`    | Ranking factor: `localix` 1.0, `official` 0.7, `community` 0.35 by default. |
| `editorial` | Whether its hero, collections and featured flags may reach Discover.        |

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
and meaning fused (`features/search/catalog-hybrid.ts`).

| Part     | How                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Words    | Field-weighted match over name, display name, tags, summary and component names; prefix on the last word while typing.                    |
| Meaning  | Each listing is a row of its own semantic collection: title, summary, tags, category and component names, embedded by the built-in model. |
| Fusion   | `catalogHits` adds the two on one scale; a meaning match counts only when it stands out from the collection.                              |
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
to every provider; the `store` provider runs `catalogHits` over its collection and the filtered
index. The Store's filters travel as a provider option on the query, so the shared `SearchQuery`
gains one optional, opaque field rather than Store-specific ones. The Store routes reach the search
service through a port wired in `bootstrap/` (A4), never by importing the search feature.

## Query path

1. Filters (shelf, kind, category, source, trust, installed, updates) narrow the in-memory index.
2. A query goes through the global search service to the `store` provider, which runs the hybrid
   search over what is left; with no query, the Store orders by score without calling search.
3. Results come back in pages of 40 with a cursor; facet counts are counted over the filtered set.
4. Typing debounces at 150 ms and cancels the previous request.

## Budgets

| Measure                                       | Budget                    |
| --------------------------------------------- | ------------------------- |
| Open the Store to first cards                 | 150 ms                    |
| Search over 5,000 listings, p95, with meaning | 60 ms                     |
| Next page while scrolling, p95                | 20 ms                     |
| Re-index one 2,300-entry marketplace          | 1 s, off the request path |
| Store index in API memory                     | 20 MB                     |

Each budget has a benchmark test over a generated index of 5,000 and 20,000 listings.

## Order of work

| Step  | Delivers                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------- |
| 2a    | Default sources list with trust and weight; plugins provider listing card fields; identities.           |
| 2b    | Categories table, static score, paged queries with facets, Store semantic collection and hybrid search. |
| 2c    | Discover from editorial picks and computed rows; lazy detail and components; adaptive UI.               |
| Later | SQLite FTS5 index past 50,000 listings; federated registries (MCP Registry) with their own search.      |

## Limits

- Ratings, install counts and popularity need a server Localix does not run; ranking uses trust,
  editorial flags, completeness, freshness and the open project only.
- A community plugin's components are unknown until its detail page has been opened once.
- Search by meaning needs the built-in embedding model; until it is ready, search is by words.

## Related guides

- [Store design](store.md)
- [Semantic search](../features/semantic-search.md)
- [Architecture rules](architecture/README.md)

## Source of truth

- [Hybrid catalog search](../../apps/api/src/features/search/catalog-hybrid.ts)
- [Catalog semantic source](../../apps/api/src/features/embeddings/list-source.ts)
- [Plugin marketplace schema](../../apps/api/src/features/plugins/marketplace.ts)

# Store design

The Store is the one place where a person finds, installs, updates and removes everything Localix
can add: mini apps, Claude Code plugins, MCP servers and, later, standalone skills and agents. This
page is the design contract for contributors: the hierarchy, the provider port, the screens and the
order of work.

Status: step 1 is implemented — the contract, the Store feature with its index and routes, the mini
apps provider and the Store UI on the kit (see [Source of truth](#source-of-truth)). Step 2's API
side is implemented: the plugins provider, the default sources, the SQLite index, search through
global search and Discover's data ([Step 2 as built](#step-2-as-built)); its screens follow. Steps
3–5 are proposed. Where step 1 differs from the first draft, this page says so under
[Step 1 as built](#step-1-as-built).

## Terminology

| Term      | Meaning                                                                          | Boundary                                                              |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Package   | What is downloaded, versioned, installed and removed as one unit.                | Kinds: mini app, plugin, MCP server, skill, agent.                    |
| Component | Something a package adds: a skill, agent, command, hook, mod, MCP or LSP server. | Never installed alone; it is a fact about a package.                  |
| Source    | Where a provider reads packages from: a catalog, a marketplace, a registry.      | Owned by its provider; the Store only shows sources side by side.     |
| Provider  | The feature that owns one package kind and serves it through the Store port.     | Keeps its own records, routes, storage and slash command (X3).        |
| Listing   | The Store's read-only projection of one package for display and search.          | A view, rebuilt from providers; never a record anything else trusts.  |
| Shelf     | A Store section: a package kind, a component kind, or a library view.            | Shelves are derived from listings; an empty shelf is hidden.          |
| Install   | A package present in one scope, with its version and enabled state.              | Scopes: `user` and `project` (Claude Code's `local`).                 |
| Plan      | What an install will add and run, computed before anything is written.           | Shown before install whenever the package runs code or is unverified. |

## Principles

1. **Browse by capability, install by package.** A person looking for skills sees standalone skills
   and every plugin that contains one, labelled with what else comes with it. Installing always
   installs the whole package, because that is what Claude Code installs too.
2. **The shell knows the contract, never a format.** The Store renders listings, plans and jobs. It
   never parses `mini-app.json`, `plugin.json` or `server.json`; that stays with the provider.
3. **Providers own everything they store.** Records, sources, install folders, routes and slash
   commands stay in `features/mini-apps` and `features/plugins` (X1, X3). The Store calls them
   through a port wired in `bootstrap/` (A4) and imports neither.
4. **Derived, rebuildable index.** The Store keeps no table of packages. Its index is rebuilt from
   providers at start and refreshed on their change notices (C rules).
5. **Show what runs.** Text-only packages install in one click. A package with hooks, mods, a
   backend, a stdio MCP or LSP server, or a `bin` shows its plan first.
6. **Nothing installs without a click**, except the documented one-time recommended mini apps
   (`recommended.ts`). There are no built-in plugins.
7. **Growth is additive.** A new package kind is one provider plus a label and a glyph. A new
   component kind is one enum value; its shelf appears when a listing reports it.

## Hierarchy

```text
Store
├── Discover                featured and recommended, across kinds
├── Packages                one shelf per package kind
│   ├── Mini apps           provider: features/mini-apps   sources: mini app catalogs
│   ├── Plugins             provider: features/plugins     sources: Claude Code marketplaces
│   ├── MCP servers         provider: features/mcp         sources: MCP Registry       (step 4)
│   └── Skills, Agents      standalone packages            sources: skill registries   (step 5)
├── Capabilities            one shelf per component kind, filled from listings' contents
│   └── Skills · Agents · Commands · Mods · Hooks · MCP · LSP · Output styles
├── Library
│   ├── Installed           every install, any kind, with scope and enabled state
│   └── Updates             installs with a newer version, "Update all"
└── Sources                 each provider's sources, grouped by provider; add with a preview
```

A listing appears on its kind's shelf and on one capability shelf per component it contains. The
"Skills" capability shelf therefore shows a standalone skill and a plugin with three skills, each
card saying what it is.

## Contract

The contract is a neutral package of types and schemas (Zod), imported by the Store feature, the
providers and the UI. It names no provider.

```ts
type PackageKind = 'mini-app' | 'plugin' | 'mcp-server' | 'skill' | 'agent'
type ComponentKind =
  | 'skill'
  | 'agent'
  | 'command'
  | 'hook'
  | 'mod'
  | 'mcp-server'
  | 'lsp-server'
  | 'output-style'
  | 'monitor'
  | 'theme'
  | 'screen'
  | 'backend'
  | 'agent-tool'
type Scope = 'user' | 'project'

interface ListingRef {
  kind: PackageKind
  id: string
} // id is stable across sources' refreshes

interface Listing {
  ref: ListingRef
  name: string
  displayName: string
  summary: string
  icon?: string // a provider media URL; absent → a monogram tile
  category?: string
  tags: string[]
  publisher: { name: string; verified: boolean }
  source: { id: string; label: string }
  version?: string
  contents: Partial<Record<ComponentKind, number>> | 'unknown'
  runsCode: boolean | 'unknown'
  featured: boolean
  recommended: boolean
  installs: Array<{ scope: Scope; version?: string; enabled: boolean; updateTo?: string }>
  job?: {
    action: 'install' | 'update' | 'remove'
    phase: JobPhase
    received?: number
    total?: number
    error?: string
  }
  incompatible?: string // why it cannot be installed here
  components?: Array<{ kind: ComponentKind; name: string; description?: string }> // when known before install
  configure?: string // a localix:// address of the provider's own settings for it
}

interface ListingDetail extends Listing {
  readme: string | null
  media: Array<{ url: string; caption?: string }>
  facts: Array<{ label: string; value: string }> // license, size, API version, homepage …
  components: Array<{ kind: ComponentKind; name: string; description?: string }>
}

interface InstallPlan {
  scope: Scope
  adds: ListingDetail['components']
  runs: Array<{ kind: ComponentKind; name: string; command?: string }>
  network: string[] // hosts a remote MCP server or backend reaches, when declared
  requires: ListingRef[] // dependencies installed with it, same kind only (X1)
  warnings: string[] // unverified publisher, command source, incompatible API …
  needsConsent: boolean
}
```

`JobPhase` is `queued | downloading | installing | done | failed`, the union of today's mini app and
plugin phases.

## Provider port

```ts
interface StoreProvider {
  kind: PackageKind
  listings(actor: StoreActor): Promise<{ listings: Listing[]; problems: string[] }>
  detail(id: string, actor: StoreActor): Promise<ListingDetail>
  plan(id: string, scope: Scope, actor: StoreActor): Promise<InstallPlan> // may fetch the package
  install(id: string, scope: Scope, consent: { plan: boolean }, actor: StoreActor): Promise<void>
  update(id: string, scope: Scope, actor: StoreActor): Promise<void>
  remove(id: string, scope: Scope, actor: StoreActor): Promise<void>
  setEnabled?(id: string, scope: Scope, enabled: boolean, actor: StoreActor): Promise<void>
  config?(id: string, scope: Scope, actor: StoreActor): Promise<ListingConfig | undefined>
  setConfig?(
    id: string,
    scope: Scope,
    values: Record<string, ConfigValue>,
    actor: StoreActor,
  ): Promise<void>
  refresh(): Promise<void> // re-read sources
  sources(): Promise<SourceView[]>
  previewSource?(input: string): Promise<SourcePreview>
  addSource?(input: string): Promise<void>
  removeSource?(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
}
```

Domain errors stay the provider's; the Store routes map them to HTTP (A7). A provider that lacks a
capability omits the method and the UI hides the control.

## Configuration

A package's own settings live on its page, in a **Settings** tab, never in Settings. A listing says
`configurable`; `GET /rpc/store/:kind/:id/config?scope=` returns a `ListingConfig` — `fields` (a
key, label, help, a type of `string | number | boolean | choice | list | model`, `required`,
`secret`), the `values`, which secrets are `set`, the `scope` shown and the `scopes` it is installed
in — and `POST` of the same path saves some of the values. The provider owns the storage (X3): the
Store only validates the request's shape. A secret's value never leaves the server, only whether it
is set. One form renders every kind (`apps/ui/src/features/store/ui/ConfigForm.tsx`), so a field
type is added once.

**Saving is explicit**: Save, Revert and Cmd/Ctrl+S, with the unsaved state said beside them. A
setting reaches running code (a server restarts, a plugin reloads), and a secret or a half-typed
address must not apply while it is typed; a form that saves per keystroke would restart a server for
every character. The form sends only the keys that changed, a refusal is said beside Save and the
edits stay. Preferences that are plain switches (Settings → Preferences) stay live: they change
nothing running.

## How it works

| Piece         | Owner                  | What it does                                                                                    |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Store feature | `features/store` (new) | Holds the provider list, the index, `/rpc/store` routes and the `store` poke.                   |
| Index         | Store feature          | A SQLite FTS5 file in the cache folder: listings, components, state, facets (`store-scale.md`). |
| Mini apps     | `features/mini-apps`   | Adapts `store.ts`, `store-detail.ts`, `catalogs.ts`; its routes stay for its own pages.         |
| Plugins       | `features/plugins`     | Lists marketplace entries with full fields, counts components, installs by `name@marketplace`.  |
| Wiring        | `bootstrap/`           | Builds each provider and hands the list to the Store (A4).                                      |
| Activity      | Store feature          | One jobs-and-updates feed for the Event Center and the update strip.                            |

Routes, all under `/rpc/store`:

| Route                                                                      | Purpose                                       |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| GET `/listings?shelf=&q=&scope=&installed=`                                | One page of listings and the facet counts.    |
| GET `/:kind/:id`                                                           | Listing detail.                               |
| POST `/:kind/:id/plan`                                                     | Install plan for a scope.                     |
| POST `/:kind/:id/install`, `/update`, `/remove`, `/enable`                 | Queue a job or switch an install; 202 or 204. |
| GET `/sources`, POST `/sources/preview`, `/sources/add`, `/sources/remove` | Sources, routed to the provider by kind.      |
| GET `/activity`, POST `/updates/apply`                                     | Jobs and available updates across kinds.      |

Plugin contents before install: an entry whose source is a relative path is already in the
marketplace checkout, so its folder is scanned and the counts cached by checkout commit. A remote
entry reports `'unknown'` until its detail page asks for a plan, which fetches it into the plugin
cache; installing reuses that fetch.

Icons: a mini app ships its own. A plugin without one gets a monogram tile drawn by the UI from the
display name; marketplace entries may add an `icon` path later, read only from the local checkout.

## Screens

```text
┌ Store ───────────────────────────────────────────────────────────────────────┐
│ [ Search everything…                               ]  Scope: User ▾          │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ Discover     │  Featured                                                      │
│ PACKAGES     │  ┌────────┐ ┌────────┐ ┌────────┐                              │
│  Mini apps   │  │ ▣ Git  │ │ ◆ wf   │ │ ▣ Docs │   card: tile, name, kind,    │
│  Plugins     │  │ app    │ │ plugin │ │ app    │   publisher ✓, summary,      │
│  MCP servers │  └────────┘ └────────┘ └────────┘   "2 skills · 1 mod · runs", │
│ CAPABILITIES │                                     install icon buttons       │
│  Skills      │  Recommended for you                                           │
│  Agents      │  …                                                             │
│  Mods        │                                                                │
│ LIBRARY      │                                                                │
│  Installed   │                                                                │
│  Updates  3  │                                                                │
│ Sources      │                                                                │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

- **Card** is the same for every kind; kind is a small label, not a different layout.
- **Detail** has a hero (tile, name, publisher, install button with a scope menu), the media
  carousel, then tabs Overview · What's inside · Permissions · Versions, then "More from this
  source". Permissions is the plan.
- **Installed** is a dense list: tile, name, kind, scope, version, enabled switch, menu (Update,
  Configure, Remove). Configure opens the provider's own settings page.
- **Sources** groups by provider: mini app catalogs, Claude Code marketplaces, later registries.
  Adding one previews it first, as the mini app catalog dialog does today.
- Settings → Plugins and Settings → Mini apps keep configuration only and link to the Store.

The Store is one work item kind, `store`, with payload `{ shelf?, ref?, addSource? }`. A restored
`mini-app-store` tab opens the Store on the Mini apps shelf. Generic pieces (card, card grid,
carousel, shelf nav) go to `packages/kit`; the screens live in one UI slice that renders the
contract and knows no provider.

## Order of work

| Step | Delivers                                                                                                   | Done when                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Contract, Store feature, index, routes; mini apps provider; Store UI on kit; old tab redirects             | Every mini app store test passes against the Store; the old routes still work. |
| 2    | Plugins provider with contents and plans; capability shelves; Installed and Updates                        | A marketplace plugin installs from its card; counts match `/plugin` output.    |
| 3    | Remove `@builtin`; `workflows` and `localix-mini-apps` as marketplace plugins; recommended plugins offered | No code names `builtin` plugins; a fresh profile installs nothing on its own.  |
| 4    | MCP servers provider over the official MCP Registry                                                        | A registry server installs into the person's MCP config with its plan.         |
| 5    | Standalone skills and agents from registries                                                               | A skill folder installs into `~/.claude/skills` and shows on Skills.           |

Each step lands with its tests first, a screenshot scenario for the Store and the docs it changes.

## Limits

- No ratings, reviews, accounts or payments: there is no Localix backend to hold them.
- No cross-kind dependencies: a plugin cannot require a mini app (X1).
- Search is the global search service's `store` provider: FTS5 words and meaning, fused
  ([Store sources, ranking and search](store-scale.md)).
- Project scope exists in the contract from step 1; the UI offers it for plugins from step 2 and
  never for mini apps, which are per person.

## Related guides

- [Plugins and mini apps](plugins-and-mini-apps.md)
- [Architecture rules](architecture/README.md)
- [Visual system](visual-system.md)

## Step 1 as built

- **The person is named.** Every provider call but `refresh`, `subscribe` and the source methods
  takes a `StoreActor` (`{ userId }`): enabled state and the yes to run a mini app are the person's.
  `listings` also returns the sources it could not read, shown above the shelf.
- **Two listing fields more.** `components` lists what it contains, one by one (kind, name,
  description), when the provider knows before install: the search reads it and the capability
  shelves list it. `configure` is the address the Installed menu's **Configure** opens. Neither
  names a provider.
- **A capability shelf lists components, not packages.** Commands shows one row per command: its
  name, what it does and "from Chess · Mini app" beside the package's tile, with a filter and an
  "Installed only" switch and no category tabs or groups. A row opens the package on What's inside
  with that component marked; its button says it installs the package ("Install Chess").
- **Cards** keep the mini app rows' layout: tile, name and verified mark, one line of summary, tags,
  actions. The kind is said off its own shelf; what is inside only where it tells the package apart
  from the others of its kind (a screen and agent tools never; "Runs code" only on the page). A
  featured listing not yet installed shows once, in Featured, not again in Available; Discover shows
  Featured and Recommended.
- **Install extras.** Beside Install a listing can offer what another UI feature provides through
  `provideStoreInstallExtra` (`shared/lib/storeInstallExtra.ts`): a label, a hint, a glyph and what
  it makes. Mini apps provide **Install as app** (a desktop app, macOS shell only); the Store draws
  each one as an icon on a card, a labelled button on the page and Add or Remove once installed, and
  names no provider.
- **Narrow panes.** The cards are one column until the content column itself is wide, and below
  42rem of Store width the shelf column becomes one section picker beside the search.
- **Shelf ids** are `discover`, `installed`, `updates`, `package:<kind>` and
  `capability:<component>` (`shelves.ts`); the UI adds `sources`. Only the components a person
  browses by get a capability shelf (`BROWSABLE_COMPONENT_KINDS`: skill, agent, command, hook, mod,
  MCP and LSP server, output style). A screen, a backend, agent tools, monitors and themes are how a
  package works: they stay facts in What's inside, and a backend counts toward "Runs code".
- **Mini app contents** come from the offer: a `workbench` surface is a screen, the `agent` surface
  is agent tools and a backend (so `runsCode`), and each declared command counts. Its plan warns
  about and needs consent for an unverified publisher (the store's `acceptUnverified`); its only
  scope is `user`.
- **The index** is rebuilt on the next read after a provider's `subscribe` fires or the relay sends
  a `store` poke for a `mini-app` or `mini-app.catalog` notice (`bootstrap/store.ts`). The mini apps
  provider lists from its catalogs as the old store page did, so a catalog older than ten minutes is
  read again on that rebuild.
- **Activity.** `/rpc/store/activity` and `/updates/apply` exist; at step 1 the Event Center's In
  progress and the update strip still read the mini app store's own feed, which stays until step 2
  adds plugin jobs to the same feed.
- **Settings → Mini apps** no longer lists catalogs: it opens the Store and its Sources.
- **Sources** offers "Add …" for every kind with a source; the contract does not yet say whether a
  provider can add one.

## Step 2 as built

The API side of step 2; the screens that use all of it come in the step's UI part.

- **Plugins are listings.** `features/plugins/store-provider.ts` lists every entry of every
  registered marketplace with what the entry gives (display name, author as publisher, category,
  tags, version, homepage). An entry inside the marketplace checkout is read from its folder for its
  components and plan (`store-contents.ts`), kept per checkout revision on disk; a remote one is
  `unknown` until its page is opened, which fetches it into the staging folder the install that
  follows reuses once within ten minutes (`fetchEntryPlugin`'s prefetch). The plan lists hooks, a
  mod, stdio MCP and LSP servers, monitors and `bin/` as what runs, and remote MCP hosts as network;
  it needs a yes for a community marketplace or code that runs. `user` is a global install,
  `project` the open project's (`StoreActor.projectId`, sent as `projectId` on the write routes).
  Installs and updates are the Store's own jobs (`store-jobs.ts`); the update pass's jobs show
  through the same field, so `/rpc/store/activity` covers plugin jobs and updates.
- **One activity feed.** The Event Center's In progress and the composer's update strip read
  `/rpc/store/activity` on the `store` poke: one row per job of any kind, opening its page in the
  Store, and one offer for every package update, whose **Update all** is `/updates/apply`. The mini
  app store's own feed and Update all routes, the `mini-app-installs` poke and the UI's plugin
  updates client are gone; Settings → Plugins still reads `/rpc/plugins/updates`.
- **Trust.** `listing.source` carries `trust` and `weight`, a `SourceView` its `trust`. A listing
  also says its `origin`, `alsoIn`, `homepage` and `updatedAt`.
- **Paging and filters.** `/listings` takes `cursor`, `limit` (40, at most 500), `category`,
  `source`, `trust` and `projectId`, and answers `nextCursor` and, for a search, `strategy`. The UI
  client reads one page per call (`storeApi.page`).
- **Capability counts are components.** A capability shelf's count is how many components it lists,
  not how many packages hold them.
- **Search hits open the Store.** A `store` hit's address is
  `localix://ui/work-item/store?kind=<kind>&id=<id>`; the Store's UI location opens on that page.

### Discover as built

`GET /rpc/store/discover` answers `{ hero, updates: { count }, rows, categories, listings }`: a
`Collection` is
`{ id, title, subtitle?, style: 'hero' | 'row' | 'grid', items: ListingRef[], source?, image? }`,
and every listing an item names is in `listings`.

| Part             | From                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Hero             | An editorial source's pick; its picture is the given `image`, else a mini app's first screenshot. |
| Start here       | What editorial sources recommend, every kind, by score.                                           |
| For this project | Listings about at least one of the open project's words; left out without a project or a match.   |
| Collections      | An editorial source's picks, mixing kinds, in the order it gives.                                 |
| New & updated    | Versions published in the last 90 days, newest first; left out when no source dates its versions. |
| One row per kind | "Mini apps", "Plugins", by score.                                                                 |

A provider hands its picks over through the port's optional `editorial()`. The mini app catalog
carries them as `editorial` (`hero`, `collections`) from `mini-apps/catalog-picks.json`; the
`localix` marketplace under `metadata.localix` (`recommended`, `featured`, `hero`, `collections`),
which `claude plugin validate` accepts with an unknown-field warning and Claude Code ignores. An
item is a name of the source's own kind, or `<kind>:<id>`. Only an editorial source's picks are
read, and a community listing never reaches the hero, Start here or a collection. A listing's page
adds `related` (more from its publisher) and `similar` (its category, sharing a tag), and `linked`,
the listings both name, so the page draws those rows in one read. When no editorial source can be
read (offline, or a catalog not published yet), the hero is the best `localix` or `official` listing
with an icon and Start here is those listings by score, so Discover is never empty while official
listings exist.

### Step 2c API as built

- **Sources say how they are.** A `SourceView` adds `syncedAt` (the provider's own fetch time, else
  when the Store last indexed it), `problem` (why it could not be read, in one sentence: a
  marketplace whose listing is unreadable is still a source, with 0 packages), `autoUpdate` (absent
  where a provider has no such switch; marketplaces have it) and `defaultSource` (on the default
  list, so not added back once removed). `GET /sources` answers `{ sources, addable }`, `addable`
  being the kinds whose provider can preview and add one. `POST /sources/refresh` reads one source
  again (a mini app catalog refresh reads every catalog) and `POST /sources/auto-update` switches
  it, through the port's optional `refreshSource` and `setSourceAutoUpdate`.
- **The open project's installs.** `GET /:kind/:id?projectId=` shows that project's install on the
  page; `GET /listings?projectId=` lays the project's installs over the page through the port's
  optional `projectInstalls(actor)` (plugins only), and the first page of Installed adds what is
  installed only in that project. The index keeps the person's installs alone.
- **A remote plugin's page answers at once.** Opening it no longer waits for the shallow fetch
  (about 0.5–1.5 s on GitHub): the page shows what the marketplace says with `contents: 'unknown'`,
  the fetch runs behind it, and its end is a `store` poke, after which the page reads its readme and
  components. A plan still waits for the fetch.

### Step 2c UI as built

`apps/ui/src/features/store/`. Every part reads the Store through one `StoreScope` (client, open
project, `open`, `show`, `goTo`, Get and its siblings), provided by `StoreView`; the UI knows no
provider (X1, A8) and only reads or writes through the Store client.

- **Layout by the pane's own width** (`model/layout.ts`): wide at 1100px and over, medium from 760,
  narrow below, measured with `useElementWidth` on the Store's root, not the window. Tiles per row,
  list columns and the sidebar mode follow it. Settings uses the same kit `SidebarNav` (full,
  compact and select modes), measuring its own width; the kit `ShelfNav` is gone.
- **Discover** renders `/rpc/store/discover` (hero, updates, rows, collections, categories) and
  sends `projectId`. A row's "See all" shows a `list` view, a paged query or a fixed set of refs.
- **Lists are cursor-paged and virtualized** (`PagedList`): `useSWRInfinite` over the keyset cursor,
  the next page asked when the window nears the end, rows windowed with `@tanstack/react-virtual`. A
  card's pointer or focus prefetches its page (`prefetchDetail`, after a short intent delay).
- **One Get** (`GetAction`, `getState.ts`): Get, progress, Open, Update, Retry. A plan that needs
  consent, or a community source, opens `ConsentSheet` first (what runs, hosts, source and trust,
  scope for a plugin with an open project); nothing is sent until Install.
- **Install extras** ("Install as app") appear on a package's page and its Get menu only, never on
  list cards, and a failed one is said once above the content.
- **Filters survive opening a page**: `useRemembered` in `StoreMemoryContext` keeps a list's
  category and source by its query, so Back returns to the list as it was.
- **Search** debounces 150 ms (`useDebounced`, the delay injected in tests) and shows packages and
  components as two groups with chips.
- **Sources** shows a source's own problem on its row, quietly; the one Add dialog previews every
  addable kind and asks only when both formats match.

### Yours and Project as built

A listing may say `authored: 'user' | 'project'`: written by the person (`user`) or kept in a
project's own folder (`project`), not fetched from a source. The `yours` and `project` shelves list
exactly those, installed or not; `onShelf`, the index's `authored` column (indexed with the listing,
the shelf filter and the facet counts) and the UI's Library navigation entries all read the one
field. The index is derived, so adding the column is a `STORE_INDEX_VERSION` bump: the old file is
deleted and rebuilt, never migrated.

## Source of truth

- [The contract](../../packages/store/src/contract.ts),
  [the port](../../packages/store/src/provider.ts) and
  [shelves](../../packages/store/src/shelves.ts)
- [Store service](../../apps/api/src/features/store/service.ts),
  [index](../../apps/api/src/features/store/index-repository.ts),
  [search provider](../../apps/api/src/features/store/search-provider.ts),
  [Discover](../../apps/api/src/features/store/discover.ts) and
  [routes](../../apps/api/src/features/store/routes.ts)
- [Mini apps provider](../../apps/api/src/features/mini-apps/store-provider.ts) and
  [its listings](../../apps/api/src/features/mini-apps/store-listing.ts)
- [Plugins provider](../../apps/api/src/features/plugins/store-provider.ts) and
  [default marketplaces](../../apps/api/src/features/plugins/default-marketplaces.ts)
- [Wiring](../../apps/api/src/bootstrap/store.ts)
- [Store UI](../../apps/ui/src/features/store/ui/StoreView.tsx)
- [Mini app store service](../../apps/api/src/features/mini-apps/store.ts)
- [Plugin marketplaces](../../apps/api/src/features/plugins/service-marketplaces.ts)
- [Marketplace entry schema](../../apps/api/src/features/plugins/marketplace.ts)

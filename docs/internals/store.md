# Store design

The Store is the one place where a person finds, installs, updates and removes everything Localix
can add: mini apps, Claude Code plugins, MCP servers, skills and agents. This page is the design
contract for contributors: the hierarchy, the provider port, the screens and how each part is built.

Status: implemented. The Store feature (contract, index, routes), the providers for mini apps,
plugins, MCP servers, skills and agents, and the Store UI on the kit are all in place (see
[Source of truth](#source-of-truth)). Settings keeps preferences and Settings → Permissions;
everything else a person adds is managed here. The sections after [Limits](#limits) describe what is
built, part by part.

## Terminology

| Term      | Meaning                                                                          | Boundary                                                              |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Package   | What is downloaded, versioned, installed and removed as one unit.                | Kinds: mini app, plugin, MCP server, skill, agent.                    |
| Component | Something a package adds: a skill, agent, command, hook, mod, MCP or LSP server. | Never installed alone; it is a fact about a package.                  |
| Source    | Where a provider reads packages from: a catalog, a marketplace, a registry.      | Owned by its provider; the Store only shows sources side by side.     |
| Provider  | The feature that owns one package kind and serves it through the Store port.     | Keeps its own records, routes, storage and slash command (X3).        |
| Listing   | The Store's read-only projection of one package for display and search.          | A view, rebuilt from providers; never a record anything else trusts.  |
| Shelf     | A Store section: a package kind, a component kind, or a library view.            | Derived from listings; an empty shelf is hidden; no name is on two.   |
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
├── Packages                one shelf per kind that is only ever a package
│   ├── Mini apps           provider: features/mini-apps   sources: mini app catalogs
│   └── Plugins             provider: features/plugins     sources: Claude Code marketplaces
├── What packages give      one shelf per component kind, filled from listings' contents
│   └── Skills · Agents · Commands · Mods · Hooks · MCP servers · LSP · Output styles
├── Library
│   ├── Installed           what came from a source (not Yours, not bundled), with scope and state
│   ├── Updates             installs with a newer version, "Update all"
│   ├── Yours               what the person wrote, installed or not
│   └── Project             what the open project's own folder holds
└── Sources                 each provider's sources, grouped by provider; add with a preview
```

A listing appears on its kind's shelf (mini apps, plugins) and on one capability shelf per component
it contains. A skill, an agent and an MCP server are package kinds too, but they have no shelf of
packages: each has ONE capability shelf, so the same word never names two lists with two counts. A
standalone one (yours, the project's, a Claude Code folder's, a registry's) is a component of its
own listing, so the "Skills" shelf shows it and the skills of every plugin together, with one count,
each row saying where it is from: its source, or "In <plugin>". The shelf is also where **Add
skill** is, and an old `package:skill` link or tab opens it.

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
  notice?: { text: string; action?: { id: string; label: string } } // shown above the page, with one action
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
  shelfActions?(scope: Scope, actor: StoreActor): Promise<ItemAction[]> // see Shelf actions
  planShelfAction?(action: string, scope: Scope, actor: StoreActor): Promise<ShelfPlan>
  runShelfAction?(
    action: string,
    scope: Scope,
    ids: string[],
    actor: StoreActor,
  ): Promise<ActionResult>
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
key, label, help, a type of `string | number | boolean | choice | multichoice | list | map | model`,
`required`, `secret`), the `values`, which secrets are `set`, the `actions`, the `scope` shown and
the `scopes` it is installed in — and `POST` of the same path saves some of the values. The provider
owns the storage (X3): the Store only validates the request's shape. A secret's value never leaves
the server, only whether it is set. One form renders every kind
(`apps/ui/src/features/store/ui/ConfigForm.tsx`), so a field type is added once.

A `map` is name and value pairs (a server's environment or headers) kept as one JSON object; a
secret map is only said to be set and replaced whole, its values masked. A `multichoice` is any of
the field's `options`, kept as a list.

**Saving is explicit**: Save, Revert and Cmd/Ctrl+S, with the unsaved state said beside them. A
setting reaches running code (a server restarts, a plugin reloads), and a secret or a half-typed
address must not apply while it is typed; a form that saves per keystroke would restart a server for
every character. The form sends only the keys that changed, a refusal is said beside Save and the
edits stay. Preferences that are plain switches (Settings → Preferences) stay live: they change
nothing running.

## How it works

| Piece         | Owner                  | What it does                                                                                       |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| Store feature | `features/store` (new) | Holds the provider list, the index, `/rpc/store` routes and the `store` and `store-sources` pokes. |
| Index         | Store feature          | A SQLite FTS5 file in the cache folder: listings, components, state, facets (`store-scale.md`).    |
| Mini apps     | `features/mini-apps`   | Adapts `store.ts`, `store-detail.ts`, `catalogs.ts`; its routes stay for its own pages.            |
| Plugins       | `features/plugins`     | Lists marketplace entries with full fields, counts components, installs by `name@marketplace`.     |
| Wiring        | `bootstrap/`           | Builds each provider and hands the list to the Store (A4).                                         |
| Activity      | Store feature          | One jobs-and-updates feed for the Event Center and the update strip.                               |

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
│ WHAT PACKAGES│  └────────┘ └────────┘ └────────┘   "2 skills · 1 mod · runs", │
│ GIVE         │                                     install icon buttons       │
│  Skills      │  Recommended for you                                           │
│  Agents      │  …                                                             │
│  Mods        │                                                                │
│ LIBRARY      │                                                                │
│  Installed   │                                                                │
│  Updates  3  │                                                                │
│  Yours       │                                                                │
│ Sources      │                                                                │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

- **Card** is the same for every kind; kind is a small label, not a different layout.
- **Detail** has a hero (tile, name, publisher, install button with a scope menu), the media
  carousel, then tabs Overview · What's inside · Permissions · Versions, then "More from this
  source". Permissions is the plan.
- **Installed** is a dense list: tile, name, kind, scope, version, enabled switch, menu (Update,
  Configure, Remove). Configure opens the item's page on its Settings tab.
- **Sources** groups by provider: mini app catalogs, Claude Code marketplaces, later registries.
  Adding one previews it first, as the mini app catalog dialog does today.

The Store is one work item kind, `store`, with payload `{ shelf?, ref?, addSource? }`. A restored
`mini-app-store` tab opens the Store on the Mini apps shelf. Generic pieces (card, card grid,
carousel, shelf nav) go to `packages/kit`; the screens live in one UI slice that renders the
contract and knows no provider.

## Limits

- No ratings, reviews, accounts or payments: there is no Localix backend to hold them.
- No cross-kind dependencies: a plugin cannot require a mini app (X1).
- Search is the global search service's `store` provider: FTS5 words and meaning, fused
  ([Store sources, ranking and search](store-scale.md)).
- Project scope is in the contract; the UI offers it for plugins and never for mini apps, which are
  per person.

## Related guides

- [Plugins and mini apps](plugins-and-mini-apps.md)
- [Architecture rules](architecture/README.md)
- [Visual system](visual-system.md)

## Provider and listing details

- **The person is named.** Every provider call but `refresh`, `subscribe` and the source methods
  takes a `StoreActor` (`{ userId }`): enabled state and the yes to run a mini app are the person's.
  `listings` also returns the sources it could not read, shown above the shelf.
- **Two listing fields more.** `components` lists what it contains, one by one (kind, name,
  description), when the provider knows before install: the search reads it and the capability
  shelves list it. `configure` is the address the Installed menu's **Configure** opens. Neither
  names a provider.
- **A capability shelf lists components, not packages.** Commands shows one row per command: its
  name, what it does and "In Chess · Mini app" beside the package's tile, with a filter and an
  "Installed only" switch and no category tabs or groups. A row opens the package on What's inside
  with that component marked; its button says it installs the package ("Install Chess"). On Skills,
  Agents and MCP servers a standalone item is one row of its own, named for itself, with its source
  ("Your skills", "This project") where a plugin's component says "In <plugin> · Plugin"; it opens
  its own page.
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
- **Shelf ids** are `discover`, `installed`, `updates`, `yours`, `project`, `package:<kind>` and
  `capability:<component>` (`shelves.ts`); the UI adds `sources`. Only `PACKAGE_SHELF_KINDS` (mini
  app, plugin) are in the navigation and the facet counts; `package:skill`, `package:agent` and
  `package:mcp-server` still parse as list filters (a source's page, the library's kind filter), and
  `parseSection` sends an old link to them to the capability shelf. A capability shelf is shown
  while its kind can make a new item, so **Add skill** has a home. Only the components a person
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
- **Activity.** `/rpc/store/activity` and `/updates/apply` carry every kind's jobs and updates; see
  [Plugins, activity and trust](#plugins-activity-and-trust).
- **Sources** offers "Add …" for every kind with a source; the contract does not yet say whether a
  provider can add one.

## Plugins, activity and trust

The API side of the plugins provider and the Store's shared services; the screens that use all of it
are under [UI](#ui).

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
  updates client are gone.
- **Trust.** `listing.source` carries `trust` and `weight`, a `SourceView` its `trust`. A listing
  also says its `origin`, `alsoIn`, `homepage` and `updatedAt`. `trust` belongs to a source and is
  said by the provider that owns it: a catalog or marketplace sets `localix`, `official` or
  `community`; what has no source to rate (a skill, agent or MCP server the person made, a built-in
  agent, a server from `.mcp.json`) leaves it out. The UI labels only what carries it (a verified
  mark, or a quiet "Community") and never infers a label for the rest; the index keeps `null` for
  it, so it is neither a `community` nor a trusted result, and ranks it with community's weight.
- **Paging and filters.** `/listings` takes `cursor`, `limit` (40, at most 500), `category`,
  `source`, `trust` and `projectId`, and answers `nextCursor` and, for a search, `strategy`. The UI
  client reads one page per call (`storeApi.page`).
- **Capability counts are components.** A capability shelf's count is how many components it lists,
  not how many packages hold them; a standalone skill is one component (its own), counted with those
  of plugins, so a name has one count.
- **Search hits open the Store.** A `store` hit's address is
  `localix://ui/work-item/store?kind=<kind>&id=<id>`; the Store's UI location opens on that page.

### Discover as built

`GET /rpc/store/discover` answers `{ updates: { count }, rows, categories, listings }`: a
`Collection` is `{ id, title, subtitle?, style: 'row' | 'grid', items: ListingRef[], source? }`, and
every listing an item names is in `listings`.

| Part             | From                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Start here       | What editorial sources recommend, every kind, by score.                                           |
| For your work    | The recommendations' answer (below), read beside Discover; left out when it is empty.             |
| For this project | Listings about at least one of the open project's words; left out without a project or a match.   |
| Collections      | An editorial source's picks, mixing kinds, in the order it gives.                                 |
| New & updated    | Versions published in the last 90 days, newest first; left out when no source dates its versions. |
| One row per kind | "Mini apps", "Plugins", by score.                                                                 |

A provider hands its picks over through the port's optional `editorial()`. The mini app catalog
carries them as `editorial` (`collections`) from `mini-apps/catalog-picks.json`; the `localix`
marketplace under `metadata.localix` (`recommended`, `featured`, `collections`), which
`claude plugin validate` accepts with an unknown-field warning and Claude Code ignores. An item is a
name of the source's own kind, or `<kind>:<id>`. Only an editorial source's picks are read, and a
community listing never reaches Start here or a collection. A listing's page adds `related` (more
from its publisher) and `similar` (its category, sharing a tag), and `linked`, the listings both
name, so the page draws those rows in one read. When no editorial source can be read (offline, or a
catalog not published yet), Start here is the `localix` and `official` listing by score, so Discover
is never empty while official listings exist.

### Recommendations

A client reports its working set with `POST /rpc/store/recommendations/working-set` (`202`, answered
later) and reads the answer with `GET /rpc/store/recommendations?projectId&sessionId`:
`{ listings, matched, strategy, pending }`. The working set is what every completion request
carries: the open tabs and linked chips as binding targets (`references`), with the open project and
chat. There is no table of what to recommend for what:

1. The references resolve through Context Fabric for the `recommendation` destination, inside the
   chat's workspace and under the same scope, containment and secret rules as a sent message
   (`bootstrap/store-context.ts`). An ambient tab ranks below a chip the person linked.
2. Every automatic provider that declares `recommendation` adds what it knows. Declaring the
   destination is how a mini app or a core feature shapes what the Store suggests; the Store names
   none of them.
3. What the person installed is read as what they use, below the working set; the open project's
   signals (`project-signals.ts`) are the last piece. So the answer improves as the Store is used,
   and a project with nothing open still has one.
4. The pieces, highest priority first and each clipped, make one query of at most 2,000 characters
   (`features/store/recommend.ts`). It searches the Store's semantic collection through global
   search with `related: true`: only meaning finds a listing, because a word the working set shares
   with a summary is no reason to call a package suited. Those are the first `matched` listings.
5. The row is never empty while anything is left to install: trusted listings by score, lifted by
   the project, then any listing, fill it to ten. None is installed.

The work runs off the request path (`recommend-board.ts`). A report settles for 1.5 seconds and an
unchanged working set is not worked out again; the answers live in memory, one per project and chat
(the last 16), and are derived data: a restart works them out again, and a read nobody reported for
is worked out from the project alone. An index sync (an install, a source read) and a move of the
semantic status (the model became ready) work every remembered set out again. An answer that moved
pokes `store-recommendations`; one that did not pokes nobody, and a failed one keeps the last.

The embedding model runs on this computer (EmbeddingGemma), so the working set never leaves it.

In the UI, Discover's **For your work** row and its **See all** list (`RecommendedView`) read the
answer, and the composer's strip shows **Recommended for you** when something `matched` is new on
this device (`shared/lib/recommendationsSeen.ts`): opening the list or hiding the notice marks it
seen. The strip gives the app's update and the Store's update offers the place first.

### Sources and project installs

- **Sources say how they are.** A `SourceView` adds `syncedAt` (the provider's own fetch time, else
  when the Store last indexed it), `problem` (why it could not be read, in one sentence: a
  marketplace whose listing is unreadable is still a source, with 0 packages), `autoUpdate` (absent
  where a provider has no such switch; marketplaces have it) and `defaultSource` (on the default
  list, so not added back once removed). `GET /sources` answers `{ sources, addable }`, `addable`
  being the kinds whose provider can preview and add one. `POST /sources/refresh` reads one source
  again (a mini app catalog refresh reads every catalog) and `POST /sources/auto-update` switches
  it, through the port's optional `refreshSource` and `setSourceAutoUpdate`.
- **An unread source is said where it matters.** A provider's `problems` are tagged with its kind
  when it is synced (`StoreProblem`: `kind`, `message`), and a listing page carries only those of
  the kinds its shelf lists (`shelfKinds`, `page-problems.ts`): a plugin marketplace on Plugins and
  on the shelves of what plugins give, a mini app catalog on Mini apps and Commands, nothing on
  Discover, a search or the library. The list says it in one line that leads to Sources, which says
  which source and why.
- **The open project's installs.** `GET /:kind/:id?projectId=` shows that project's install on the
  page; `GET /listings?projectId=` lays the project's installs over the page through the port's
  optional `projectInstalls(actor)` (plugins only), and the first page of Installed adds what is
  installed only in that project. The index keeps the person's installs alone.
- **A remote plugin's page answers at once.** Opening it no longer waits for the shallow fetch
  (about 0.5–1.5 s on GitHub): the page shows what the marketplace says with `contents: 'unknown'`,
  the fetch runs behind it, and its end is a `store` poke, after which the page reads its readme and
  components. A plan still waits for the fetch.

### UI

`apps/ui/src/features/store/`. Every part reads the Store through one `StoreScope` (client, open
project, `open`, `show`, `goTo`, Get and its siblings), provided by `StoreView`; the UI knows no
provider (X1, A8) and only reads or writes through the Store client.

- **Tiles** (`TileCard`): the icon, the name in up to two lines, one quiet meta line (publisher, a
  verified mark, then the kind, which is kept when the publisher is cut) and the Get pill at the
  right of the same row. Every tile is as tall as its icon, so a row is even. A row (`ShelfRow` with
  `columns`) is a grid of whole tiles, never one cut at the edge: Discover shows at most two rows of
  it and "See all" has the rest; a package page's rows wrap to show every tile. Categories are chips
  that wrap.
- **The bar** (`ui/StoreNav.tsx`, `storeNav` in `model/navigation.ts`): the search and the library
  (Installed, Updates, Yours, Project, Sources) on one row, the catalog as a kit `TabBar` under it:
  Discover, the package kinds, Skills, Agents and MCP servers. The other kinds packages give sit in
  a More menu in the bar's trailing slot, named for the one chosen. Only Updates carries a count.
  There is no section column; Settings draws its sections as tabs too.
- **Layout by the pane's own width** (`model/layout.ts`): wide at 1100px and over, medium from 760,
  narrow below, measured with `useElementWidth` on the Store's root, not the window. Tile columns
  (`tileColumns`: 1 below 560px, 2 below 860, 3 below 1200, then 4), list columns and where a
  package page puts its facts follow it.
- **Discover** renders `/rpc/store/discover` (updates, rows, collections, categories) and sends
  `projectId`. A row's "See all" shows a `list` view, a paged query or a fixed set of refs.
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
- **Sources are not in the index, so they have their own poke.** `store-sources` fires the moment a
  source write (switch, read again, add, remove) is done, and after a sync when what the sources
  look like (`sourcesOf`, compared as text) moved on its own; the Sources page reads on it, never on
  `store`. The plugin provider's marketplace list is one `known.json`: every change to it takes the
  one registry lock and is written aside and renamed in.
- **Sources** shows a source's own problem on its row, quietly; the one Add dialog previews every
  addable kind and asks only when both formats match.

### Create and actions as built

Two optional port methods make the Store a place to write things, not only to fetch them, and both
are generic: no kind is named.

- **Create.** `createFields(actor)` answers a `CreateForm` (`noun`, `fields`, the `scopes` it can be
  kept in) and `create(scope, values, actor)` makes the item and answers its ref. Routes:
  `GET /create` (the kinds that can), `GET` and `POST /create/:kind`. The UI draws **Add
  &lt;noun&gt;** on that kind's shelf (shown even while it is empty) and on Yours and Project; its
  dialog is the one configuration form in creation mode, with a scope choice when a project is open.
  A refusal is said in the dialog; success opens the new item's page.
- **Actions.** A `ListingConfig` lists `actions` (`id`, `label`, `danger`);
  `runAction(id, scope, action, actor)` does one and answers `{ ok, message?, open? }`.
  `POST /:kind/:id/action` routes it. The Settings tab shows the buttons below the form (Test
  connection, Sign in, Sign out), says the message beside them, opens an `open` address in the
  browser and reads the settings again.

### Yours and Project as built

A listing may say `authored: 'user' | 'project'`: written by the person (`user`) or kept in a
project's own folder (`project`), not fetched from a source. The `yours` and `project` shelves list
exactly those, installed or not.

**Installed and Yours do not overlap.** Installed is what came from a source: a listing with an
install that is neither `authored` nor `bundled`. A listing says `bundled: true` when it comes with
Localix or with an installed plugin (the shipped agent types, a plugin's agents): it has an install
state to switch, but the unit that was installed is the package it comes with, so it is not on
Installed. What the person wrote is on Yours (or Project) and nowhere else in the Library. The index
keeps `bundled` as a column, next to `authored`.

- **Yours** is indexed: the index's `authored` column, the shelf filter, the facet count and the
  Library navigation entry all read the field. The index is derived, so adding the column is a
  `STORE_INDEX_VERSION` bump: the old file is deleted and rebuilt, never migrated.
- **Project** is never indexed. The index is the person's, and a project's files belong to that
  project alone, so a provider's `listings` must not return them. A provider that keeps files per
  project implements `projectListings(actor)` (the open project's, like `projectInstalls`); the
  Store asks on each read that carries a `projectId`, serves the Project shelf from the answer and
  adds its count to the facets. With no open project the shelf is empty and hidden.

### MCP servers

The `mcp-server` kind is served by `apps/api/src/features/mcp/store-provider.ts`. A server is not
downloaded, it is made here, so the provider has no sources and no install: `install`, `update` and
`plan` refuse and say to use **Add MCP server**. Everything else is the generic contract.

- **Where the servers come from, and what can be done with each.**

  | Server                                                         | Listing id            | Shelf   | Settings, remove |
  | -------------------------------------------------------------- | --------------------- | ------- | ---------------- |
  | Added by the person                                            | `<name>`              | Yours   | yes              |
  | Added for a project                                            | `project:<name>`      | Project | yes              |
  | In Claude Code's files: `~/.claude.json`, managed settings     | `file:<scope>:<name>` | Yours   | read-only        |
  | In Claude Code's files: a project's `.mcp.json`, local entries | `file:<scope>:<name>` | Project | read-only        |

  Ids are built from the name, so they survive a recreation. A server of a file has no Settings tab
  and cannot be removed here (the refusal names the file); its page says where it is defined and
  shows how it connects, never what it holds. Its switch still works: availability is a rule by
  name, not an edit of the file. The project's servers are served by `projectListings` and never
  indexed.

- **Plugin servers are not listed.** A server a plugin bundles is a component of that plugin: it
  appears on the plugin's page under "What's inside", follows the plugin's own switch and is removed
  with it. Listing it as an item of its own would give one server two switches and two owners, and
  would make the MCP provider read plugin state (A4). The rules editor can still name it
  (`mcp:<plugin>_<server>`).
- **Secrets.** Headers, environment variables and a pre-registered OAuth client secret are sealed in
  the vault under `mcp-option.…` (`store-secrets.ts`, the option vault plugins and mini apps use);
  the row keeps a handle. A secret map is one vault item, replaced whole, and the Settings tab only
  learns that it is set. Every read a connection is made from, a run's or a test's, puts them back.
  Clearing a map leaves its vault item until the server is removed.
- **Settings tab.** Description, how it connects (a program, a web address or a web socket),
  command, URL, environment, headers, OAuth client id, secret and scope, and the tool call timeout.
  Actions: **Test connection** for all, **Sign in** and **Sign out** for a web address. A test
  remembers the tools the server has, and the tab then shows **Tools**, one switch each, saved as
  the `mcp:<server>/<tool>` rules the run already reads. Saving refuses a server that could not
  connect (a program without a command, a web address without a URL).
- **Names are the handle.** A name is chosen when the server is added and not changed: it names the
  server's rules and its vault items.

### Skills

The `skill` kind is served by `apps/api/src/features/skills-curator/store-provider.ts`, over the
SKILL.md operations of the chat service and the curator, both handed in as ports (`bootstrap/`
builds them, A4). Like an MCP server a skill is made here, so `install`, `update` and `plan` refuse
and say to use **Add skill**.

| Skill                                                                             | Listing id       | Shelf   | Settings, remove |
| --------------------------------------------------------------------------------- | ---------------- | ------- | ---------------- |
| In `~/.claude/skills`                                                             | `user:<name>`    | Yours   | yes              |
| In a project's `.claude/skills`                                                   | `project:<name>` | Project | yes              |
| In another folder (`.agents/skills`, a command file, a parent's `.claude/skills`) | `user:<name>`    | Yours   | read-only        |
| A plugin's                                                                        | not listed       |         |                  |

- **Commands are skills.** A `.claude/commands/<path>.md` file is already discovered as a skill
  named with `:`, so it appears as a read-only skill. There is no `command` package kind.
- **Settings tab.** Description and instructions (a `multiline` field, one text area). Actions:
  **Pin** or **Unpin**, **Archive**. An archived skill stays on its shelf with an `archived` tag,
  its switch off and one action, **Restore**; it cannot be removed until restored.
- **Switch.** A `skill:<name>` availability rule, set by the switch on the skill's page or Installed
  row; an agent's **Access** tab sets it for that agent alone. The name is the identity and is not
  changed after the skill is added.
- **Shared folder.** `.claude/skills` is Claude Code's too, and its use of a skill is invisible
  here. The `skill_usage.localix_authored` flag marks a skill created in Localix (the Store's
  create, the `Skill` tool's first save); the curator's `stale` state, the scheduled pass, **Archive
  unused** and the unused notice apply to those alone. Pin, manual archive and Restore work for
  every skill. Archived skills wait in `~/.localix/skills-archive/{user|<projectId>}/<name>`,
  outside Claude Code's tree.
- **Curator.** The weekly scheduled pass (`bootstrap/ops-timers.ts`) archives the person's own
  unused skills; archive, restore and pin go through the same service. Its manual run is the
  **Archive unused** [shelf action](#shelf-actions) (the `/rpc/skills/curator` route is gone). The
  staleness rule lives once, in `skills-curator/staleness.ts`: pinned never; used, stale 90 days
  after the last use; never used, 30 days after it was made. The curator's records carry
  `idleSince`, `staleAt` and `archiveOn` (the first scheduled pass on or after `staleAt`, counted
  from the pass marker; null for a pinned, archived or project skill, which no scheduled pass
  touches).
- **Unused notice.** A skill's detail has a `notice` ("Not used for N days. Archived on <date>
  unless pinned.", or "Never used, made N days ago. …") when it is stale or its `archiveOn` is
  within two scheduled intervals, with **Pin** as its `action`; the page draws it with the kit's
  `workbench-notice-bar` and runs the action as the item's own. A project skill says "Archive unused
  on the Project shelf would archive it unless pinned" once stale.
- **After a scheduled pass.** The curator's `onArchived` port reaches
  `notifications/producers/skills-curator.ts` (wired in `bootstrap/domain-services.ts`): one journal
  row per pass that archived something, never for a pass that archived nothing, with **Open to
  restore** (the skill's page) or **Open skills**.

### Shelf actions

An action on a whole shelf of a kind's own items. The port has three optional methods:
`shelfActions(scope, actor)` (what to offer: `user` is Yours, `project` the open project's shelf),
`planShelfAction(action, scope, actor)` (a `ShelfPlan`: a summary and each item with `ref`, `name`
and `reason`; computed, written nowhere) and `runShelfAction(action, scope, ids, actor)` (does it to
the ids the person confirmed, leaving out any that no longer qualify). Plan then run mirrors
install's plan then consent: nothing is written without the preview shown.

| Route                                                        | Purpose                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| GET `/shelf-actions?scope=&projectId=`                       | The actions each kind's provider offers for that shelf.  |
| POST `/shelf/:kind/plan` `{ scope, action, projectId? }`     | The preview.                                             |
| POST `/shelf/:kind/run` `{ scope, action, ids, projectId? }` | Does it to the confirmed ids; answers an `ActionResult`. |

Skills offer one, **Archive unused** (`archive-unused`): the preview lists the stale, unpinned
skills of that shelf with "Last used N days ago" or "Never used, N days old". The UI draws the
button beside **Add skill** on Yours and Project (`ShelfActions.tsx`), shows the list in a dialog
and sends back the ids it showed.

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
- [MCP servers provider](../../apps/api/src/features/mcp/store-provider.ts) and
  [its secrets](../../apps/api/src/features/mcp/store-secrets.ts)
- [Plugins provider](../../apps/api/src/features/plugins/store-provider.ts) and
  [default marketplaces](../../apps/api/src/features/plugins/default-marketplaces.ts)
- [Wiring](../../apps/api/src/bootstrap/store.ts)
- [Store UI](../../apps/ui/src/features/store/ui/StoreView.tsx)
- [Mini app store service](../../apps/api/src/features/mini-apps/store.ts)
- [Plugin marketplaces](../../apps/api/src/features/plugins/service-marketplaces.ts)
- [Marketplace entry schema](../../apps/api/src/features/plugins/marketplace.ts)

# Store design

The Store is the one place where a person finds, installs, updates and removes everything Localix
can add: mini apps, Claude Code plugins, MCP servers and, later, standalone skills and agents. This
page is the design contract for contributors: the hierarchy, the provider port, the screens and the
order of work.

Status: step 1 is implemented — the contract, the Store feature with its index and routes, the mini
apps provider and the Store UI on the kit (see [Source of truth](#source-of-truth)). Steps 2–5 are
proposed. Where step 1 differs from the first draft, this page says so under
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
  componentNames?: string[] // names of what it contains, when known before install; searched
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

## How it works

| Piece         | Owner                  | What it does                                                                                    |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Store feature | `features/store` (new) | Holds the provider list, the index, `/rpc/store` routes and the `store` poke.                   |
| Index         | Store feature          | In-memory listings by ref, a token search over name, summary, tags and component names, facets. |
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
- Search is local token matching over cached listings; semantic search can be added to the index.
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
- **Two listing fields more.** `componentNames` feeds the search; `configure` is the address the
  Installed menu's **Configure** opens. Neither names a provider.
- **Shelf ids** are `discover`, `installed`, `updates`, `package:<kind>` and
  `capability:<component>` (`shelves.ts`); the UI adds `sources`. The `backend` component counts
  toward "Runs code" and has no shelf of its own.
- **Mini app contents** come from the offer: a `workbench` surface is a screen, the `agent` surface
  is agent tools and a backend (so `runsCode`), and each declared command counts. Its plan warns
  about and needs consent for an unverified publisher (the store's `acceptUnverified`); its only
  scope is `user`.
- **The index** is rebuilt on the next read after a provider's `subscribe` fires or the relay sends
  a `store` poke for a `mini-app` or `mini-app.catalog` notice (`bootstrap/store.ts`). The mini apps
  provider lists from its catalogs as the old store page did, so a catalog older than ten minutes is
  read again on that rebuild.
- **Activity.** `/rpc/store/activity` and `/updates/apply` exist; the Event Center's In progress and
  the update strip still read the mini app store's own feed (`/rpc/mini-apps/store/activity`), which
  stays until step 2 adds plugin jobs to the same feed.
- **Settings → Mini apps** no longer lists catalogs: it opens the Store and its Sources.
- **Sources** offers "Add …" for every kind with a source; the contract does not yet say whether a
  provider can add one.

## Source of truth

- [The contract](../../packages/store/src/contract.ts),
  [the port](../../packages/store/src/provider.ts) and
  [shelves](../../packages/store/src/shelves.ts)
- [Store service](../../apps/api/src/features/store/service.ts),
  [index](../../apps/api/src/features/store/listing-index.ts) and
  [routes](../../apps/api/src/features/store/routes.ts)
- [Mini apps provider](../../apps/api/src/features/mini-apps/store-provider.ts) and
  [its listings](../../apps/api/src/features/mini-apps/store-listing.ts)
- [Wiring](../../apps/api/src/bootstrap/store.ts)
- [Store UI](../../apps/ui/src/features/store/ui/StoreView.tsx)
- [Mini app store service](../../apps/api/src/features/mini-apps/store.ts)
- [Plugin marketplaces](../../apps/api/src/features/plugins/service-marketplaces.ts)
- [Marketplace entry schema](../../apps/api/src/features/plugins/marketplace.ts)

# Daily Log

Daily Log is the reference mini app: the one every new mini app is created from. A person logs what
they eat, spend or do — by telling the agent in the chat, attaching a photo, or typing it in — and
sees today's total against a daily goal, what each category added, the last seven days and today's
entries.

## Run it

Install dependencies from the repository root with `bun install --frozen-lockfile`, then:

```bash
cd mini-apps/template
bun run dev
```

Open `http://127.0.0.1:5174`. This starts Vite and the same backend on loopback port 5175, over a
data folder of its own. In Localix, open **Daily Log** from the workspace overflow menu or the
command palette.

| Command                    | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `bun run dev`              | Start the backend and hot-reloading preview             |
| `bun run build`            | Type-check and build preview, UI module and Bun backend |
| `bun run preview`          | Serve built UI on 4174 and backend on 4175              |
| `bun run type-check:tests` | Check production and test TypeScript                    |
| `bun run test`             | Run mini app regression tests                           |

## Architecture

The plumbing — routes, durable storage, the feed that updates an open screen when the agent writes,
semantic search — is the SDK's app layer (`createMiniApp`, `defineCollection`, `useCollection`,
`screenUi`). What is here is only the app.

| Location              | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `mini-app.json`       | Identity, category, the settings (`DAILY_GOAL`, `UNIT`) and the backend |
| `guide.md`            | What the agent reads before it first uses the app                       |
| `icon.svg`            | Its icon in the store, the rail and its Mac app                         |
| `shared/model.ts`     | The entry schema and the summary the screen shows and the agent is told |
| `backend/entries.ts`  | The entries collection: how an entry is made and what search reads      |
| `backend/settings.ts` | The settings, read from `ctx.config`, and the route the screen reads    |
| `backend/tools.ts`    | The agent's tools: log, summary, find by meaning, remove                |
| `backend/index.ts`    | `register(ctx)`: the collection, the routes and the tools               |
| `ui/App.tsx`          | The screen: reads, the agent context and the problem line               |
| `ui/parts/`           | Today's ring and categories, the week chart, the list and the quick add |
| `ui/register.tsx`     | The tab, its launcher and what the agent is told while it is open       |
| `preview/`            | Standalone shell and loopback backend runner (this repository only)     |

The screen and the tools compute every number with the same `summarize`, and the screen publishes
that summary as message context, so the agent and the person always see the same day. The goal and
the unit come from Settings → Mini apps; a changed setting re-wires the backend, so the screen and
the tools pick it up without a restart.

## Make your own

`mini-app create <name> --description "…"` from the mini-app-authoring plugin copies this app under
a new name, renames its identity and tools, and prints the instruction an agent follows to replace
the domain. `scaffold.json` says which files a copy keeps (entries), which it replaces (domain) and
which identifiers `mini-app check` reports when a copy still carries them.
[Publish a mini app](../../docs/extending/mini-app-publishing.md) covers packing and sharing.

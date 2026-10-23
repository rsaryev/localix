# Code map for contributors

This page names the modules a change usually passes through, so you do not have to reconstruct the
architecture by reading a dozen files. [Architecture](architecture.md) explains the system, and this
page says where to put a change.

## Commands

```bash
bun run dev                  # native desktop app (Tauri)
bun run dev:workspace        # API and UI dev servers without the desktop shell
bun run test                 # every workspace's unit tests, the scripts workspace included
bun run test:integration     # real processes, PTYs and watchers, every workspace
bun run check:size           # product code under the 500,000-line budget (comments not counted)
bun run type-check           # tsc across workspaces (`check:tests` covers test files)
bun run lint:changed         # oxlint on files that differ from main, the fast local loop
bun run format               # oxfmt --write
```

Run one test from the repository root so `bunfig.toml`'s preload and vendor ignore apply:

```bash
bun test apps/api/src/features/chat/wake-provenance.test.ts   # one file
bun test apps/api/src/features/loops                          # a path substring, not a directory
bun test apps/ui/src/entities/chat -t "renders the queue"     # filter by test name
```

`bun test <filter>` matches substrings, so keep filters specific. Turbo caches test and build
results, so suspect the cache when a failure disappears without an edit.

## Runtime shape

A Bun and Hono API (`apps/api`) owns the agent runtime, tools, permissions, storage and one
multiplexed websocket (`/rpc/ws`) that carries every live update. The React workspace (`apps/ui`) is
a typed Hono RPC client over that API. `apps/desktop-tauri` wraps both as the shipped app, and
`apps/landing` is the product and documentation site. Everything persisted lives under `~/.localix`
(`localix.db`, the vault and `plugins/`); `plugins/` in the repository is source that is staged into
that home.

The desktop [agent island](agent-island.md) uses a separate UI entry and the existing chat and
attention pipelines. Its native host lives in `companion.rs` (page commands in
`companion_commands.rs`), `companion_macos.rs` and `companion_pointer.rs`; quick-chat surfaces live
under `features/companion/` and render the shared `PromptInput` (`layout="embedded"`) and
`MessageList`. Island sizes live in `features/companion/model/geometry.ts` and its Rust mirror
`companion::geometry`. Durable draft and surface state lives in API `features/user/view-state-*` and
UI `shared/lib/view-state`; `useComposerDraft` is shared by the main composer and island.

A [plugin app](plugin-apps.md) is a plugin installed as its own macOS app: a generated bundle whose
executable is a clone of the desktop binary. `app_runner*.rs` is that binary's app mode (window,
glass, menu, the page served from the host's UI build); `app_bundle*.rs` and `app_icon.rs` install,
refresh and remove the bundles. The page is the workspace with `chrome="app"`, driven by
`shared/lib/pluginApp.ts` and `pages/chat/model/useMiniApp.ts`; each app's conversations live in a
project of its own (`shared/lib/pluginAppProject.ts`). Install actions and icons live in
`features/plugin-apps/`.

An extension is a [plugin and a mini app](plugins-and-mini-apps.md): `.claude-plugin/plugin.json` in
the Claude Code format, read by `packages/claude-plugin` (no Localix knowledge), and
`.localix-app/app.json` (`@localixai/mini-app-sdk/app-manifest`).
`apps/api/src/features/plugins/layout/` reads both (`read.ts`), composes the one runtime manifest
the loader uses (`compose.ts`, with `claude-code.ts` for the Claude Code mapping), splits a legacy
root `plugin.json` (`split.ts`) and finds where the build writes the backend (`backend-pointer.ts`).

## Boot is phased, and the phases exist because of cycles

`apps/api/src/bootstrap.ts` composes the `bootstrap/*` phases in order: infra, registries,
plugin-hosts, domain-services, engines, chat-service-deps, agent-facade, app-services, create-app
and ops-timers. `serviceRefs` is the forward holder for genuine cycles: a service that needs the
finished `chatService` (its wake primitive, stream registry or cwd resolution) is built in
`bootstrap/session-services.ts` and read back lazily.

## The agent boundary is enforced

`features/agent-core` is the provider-agnostic agent loop: tools, prompts, permissions and profiles.
`features/chat` is one host that drives it. agent-core must not value-import `features/chat`, and
`agent-core/agnostic-boundary.test.ts` reads the sources to prove it. So a tool never reaches for
the chat runtime: it declares an injected host port, one key of `OptionalToolPorts` named after the
tool (`optional.loops`, `optional.browser` and so on), and
`features/chat/runtime/run/runtime-tool-ports.ts` builds it for `runtime-tools.ts`.
`createRuntimeToolRegistry` takes three bags: `policy` (surface, profile, disabled tools and plugin
`extraTools`), `core` (the dependencies of the always-on tools) and `optional` (the ports).

## A tool's path to the model

`agent-core/tool-names.ts` (the `BUILTIN_TOOL_CATALOG`) feeds `run-shape.ts`
(`resolveRunProfile(agent, sessionKind)` gives `toolExposure`, plus `openToolset` for chat). That
feeds `createRuntimeToolRegistry` (`tool-registry-core.ts`, `tool-registry-optionals.ts` and plugin
`extraTools`), and then the filters apply: the client's `toolSurface`, `interactiveOnly` for
non-chat runs, and the effective `disabledTools` (the capability rules of the global, project and
agent chain). The system prompt ships only the roster of names. Per-tool semantics stay in the
schema, and prompt sections gate on `hasTool(...)` (`agent-core/prompt/sections/`, ordered by
`prompt/catalog.ts`).

## Wakes: one primitive, many producers

`chatService.wakeSession(request: WakeRequest)` (`chat/contracts/queue.ts`: user, session, content,
a required `source`, and optional `to` and `deliveryKey`) is the only way a turn starts without a
person typing. Each producer has its `source`:

| Producer                                           | `source`     | Where                                             |
| -------------------------------------------------- | ------------ | ------------------------------------------------- |
| A loop's trigger fire                              | `loop`       | `bootstrap/loop-action.ts`                        |
| A background job's exit notice                     | `bg-job`     | `runtime/exit-notices.ts`                         |
| A monitor's event                                  | `bg-monitor` | `features/monitors/action.ts`                     |
| A finished sub-agent's report                      | `subagent`   | `runtime/delegation-report.ts`                    |
| A Claude Code `asyncRewake` hook                   | `hook`       | `features/cc-hooks`                               |
| A reaction on a message                            | `reaction`   | `chat/contracts/queue.ts` (the `WakeSource` list) |
| The person's **Continue** on stopped work          | `resume`     | `features/resume/registry.ts`                     |
| Plugin backends, plugin monitors, inbound webhooks | `external`   | `chat/contracts/queue.ts` (the `WakeSource` list) |

A `resume` point is registered by a producer such as the approved plan, and the client offers one
only while nobody works on the conversation. No plugin board wakes a session: the bundled `kanban`
plugin records work and never starts a run.

Every wake enters the durable priority queue (`features/chat/runtime/wake-queue.ts`, admission in
`wake-queue/wake.ts`). An entry is typed by its kind (`wake-queue/entry.ts`): the person's words, a
queued command, a machine event, a child's report, or an agent ticket. One table says what the queue
does with each kind (`wake-queue/kinds.ts`): whether a running model may take it, which entries it
is delivered with, and how a delivery is worded and routed. The person's words are priority 0 and
pre-empt wakes at 10, and `SELF_CAUSED_WAKES` bounds agent-caused chains.

Some entries are delivered together as one turn (`wake-queue/selection.ts`):

- the reports to one delegator, held while its other children are still owed a report
  (`wake-queue/holds.ts`, five minutes at most);
- the wakes of one stream (`WakeRequest.coalesce`, such as a monitor's fires);
- the person's lines typed in a row for the same agents.

A band claimed together keeps its name (`batch_id`) until it is acknowledged, so a delivery that a
crash interrupted replays with the same entries and transcript row. A wake persists a hidden
internal user row carrying its `WakeSource`, and `features/chat/wake-provenance.ts` lifts that onto
the next visible assistant message, which is what renders the "via Loop" chip.

A trigger's fire and every producer that cannot await a turn (plugin backends and monitors, a
finished child's report, a reaction) wake through one delivery, `features/triggers/delivery.ts`.
`deliver` answers delivered, missed or failed, and `send` logs an undelivered one against its
subject. It is bound once in `bootstrap.ts` as `wakes`. A fire is keyed `trg:<id>:<seq>`, so a
retried fire is the same delivery, and nothing skips a busy session because the queue holds the
wake. A loop is the exception on purpose: its fire settles on the run's outcome
(`wakeSessionAndWait`), not on admission.

## Long-running work

`bash background:true` spawns a `BgProc` (`agent-core/tools/bash/bash-process.ts`), a PTY pane when
a terminal host is wired and a detached child otherwise, and registers live actions with the run's
`asyncRegistry` (`features/chat/runtime/run/async-registry.ts`). That records the job in the work
registry (`features/work/registry.ts`): one durable row per job, monitor, promoted call or detached
sub-agent (`run/subagent-work.ts`), one `bg-N`, `mon-N` or `sub-N` namespace per session that never
reuses an id, and one owner filter (`work.list` and `work.resolve`) that the `jobs` tool, the prompt
and the snapshot all read through. Work still `running` at boot was lost with the old process:
`hydrate` marks it `lost`, and `runtime/lost-work.ts` corrects the tool item that showed it.

A monitor (`bash until`) is a trigger (`poll`, or `stream` for a watched command;
`features/monitors/action.ts` is what its fire does) plus a work record whose `event_count` and
`last_event` the composer's work strip shows. Its work is held at boot until the triggers load, so a
polled wait resumes (`work.adopt`) and a stream ends with `restart` and one wake
(`bootstrap/triggers.ts` orders this).

A `notify` job's finish and a Claude Code `asyncRewake` hook's exit 2 are exit notices
(`runtime/exit-notices.ts`): a `process-exit` trigger armed as the process starts and fired once
(`trg:<id>:1`, where a repeat is a duplicate). It is dismissed for an exit nobody awaits, and for a
job it sends one "lost" wake when a restart killed it. A fact that becomes true in the middle of a
turn, such as a finished job, rides `runtime/mid-run-reminders.ts` and is drained at a tool-result
seam rather than opening a new turn.

## Streaming and the read model

[Client/server interaction and workspace synchronization](client-server-sync.md) maps every
transport, shared read model, window-owned state and recovery rule. Shared resource mutations are
announced by their owners and relayed to topics in `features/realtime/relay.ts`; client adapters use
`shared/api/resourceSync.ts` over the existing socket. Conversation roster events apply directly,
while low-frequency resource changes coalesce into authoritative reads.

`features/chat/runtime/session-stream-registry.ts` tags each opcode (`replayable`, `watched`).
`scripts/stream-contract-guard.test.ts` pins the opcode set in both directions. A new server event
without a handler in `apps/ui/src/shared/api/applyStreamEvent/` (one file per event family, merged
by the typed map in `applyStreamEvent.ts`, which also fails `tsc` for a missing opcode) fails the
suite, because a client that does not know an opcode drops it silently. Ephemeral runtime state,
such as active loops and the queue, is overlaid onto the read model in
`features/chat/service/query-facade.ts` and has no database column.

## The UI

The UI is feature-sliced: `app`, `pages`, `widgets`, `features`, `entities` and `shared`.
`entities/chat` (the chat store, transcript and composer) and `entities/workspace-grid` (the grid
store) sit below the features that read them. Server calls go through the typed client in
`shared/api/client.ts`, and live state lands in `shared/api/applyStreamEvent.ts`. A response is read
with `unwrap`, whose type comes from the route itself, so renaming a field in an API route is a type
error where the UI reads it. Write no type argument for it and fetch no `/rpc/` URL by hand;
`scripts/api-contract-guard.test.ts` fails on both.

Live session state is surfaced above the composer through the strips in
`entities/chat/ui/prompt-input/ComposerHeaderStrips.tsx`; follow that pattern rather than adding a
second place. The shared plugin runtime is `@localixai/mini-app-sdk/ui`, and `apps/ui` never names a
specific plugin. The rules for menus and for marking a recommended step are in
[Visual system](visual-system.md).

## Shared leaves

`apps/api/package.json` exports narrow subpaths (`./tool-names`, `./item-format`,
`./wake-provenance`, `./loops-format` and others) so the browser imports the one owner of a rule
instead of the server bundle. When both sides need the same rule, give it a leaf and delete the
copy. Two copies drifting is why `wake-provenance` exists.

## Where to touch for a typical change

| Change                  | Path through the code                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model-facing tool     | `agent-core/tools/<tool>` + catalog entry in `tool-names.ts` + a port keyed by the tool name in `OptionalToolPorts` (`tool-registry.ts`) + its `optional.<name>` branch in `tool-registry-optionals.ts` + the host port in `chat/runtime/run/runtime-tool-ports.ts` + prompt section (`tool-port-shape.test.ts` pins the three in lockstep)                                                                                                                                                  |
| A stream event          | `chat/contracts/stream.ts` + `session-stream-registry.ts` + publisher + a handler in its family under `ui/shared/api/applyStreamEvent/` (guarded)                                                                                                                                                                                                                                                                                                                                            |
| Live state in the input | `chat/contracts/read-model.ts` + `service/query-facade.ts` overlay + a strip in `ui/.../prompt-input/` wired into `ComposerHeaderStrips.tsx`                                                                                                                                                                                                                                                                                                                                                 |
| A new wake producer     | its own `features/<x>` engine + `bootstrap/session-services.ts` (or `engines.ts`) + a `WakeSource` in `chat/contracts/queue.ts` + label in `wake-provenance.ts` + the one delivery `wakes` (`triggers/delivery.ts`) if it cannot await a turn                                                                                                                                                                                                                                                |
| A new kind of Continue  | a `ResumeProducer` (`features/resume/contracts.ts`: `list` + `take`) registered in `bootstrap/session-services.ts`, and `registry.changed(owner)` when its work changes; the UI needs nothing (`ResumeStrip`) unless the kind has its own row (`RESUME_KINDS_WITH_OWN_ROW`). Never a per-feature Continue button or endpoint                                                                                                                                                                 |
| A model judgment        | a typed question to `features/decisions` (`DecisionService.decide`, its own `purpose`; `usageKind: 'routing'` only for routing) or texts to `semanticService.vectors` (`embeddings/semantic-vectors.ts`: `rank`, `embed`), the ports search, group routing and plugins share. Models are named only in `decisions/models.ts` and `embeddings/models.ts`. Never resolve a model, keep a deadline or compute a cosine in the consumer; always keep its fallback for an outcome without answers |
| A plugin capability     | `plugins/<name>`: agent parts in `.claude-plugin/` and its component folders, Localix parts in `.localix-app/app.json` + `@localixai/mini-app-sdk` contract; remember plugins run from `~/.localix/plugins`                                                                                                                                                                                                                                                                                  |
| A schema change         | a new file in `apps/api/migrations/` + `db/types.ts`; no existing migration is ever renamed, edited or deleted, because `bun run dev` has already run it on your database (`migration-ledger.ts` refuses to boot, `migration-freeze.test.ts` refuses in CI); see `apps/api/migrations/README.md`                                                                                                                                                                                             |

Markdown grammar and portable rendering live in `packages/markdown`; the workspace owns mentions,
streaming cadence and content actions, while `apps/landing/src/pages/docs` owns documentation links
and layout. See [Shared Markdown](../extending/markdown.md).

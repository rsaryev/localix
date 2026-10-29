# Optional UI tests and product captures

Run these Playwright tests deliberately. They are excluded from Bun's normal discovery and are not
part of CI. Each scenario performs real UI actions, checks the result, and only then writes a native
4800×3000 PNG. No DOM replacement, CSS recoloring, pixel retouching, real provider credentials or
model calls are needed. Composer scenarios seed an explicitly fake provider key in the isolated
database to exercise the configured composer; it never reaches a provider.

The suite covers the core only: chat, composer, workspace, settings, agents, providers and the
Store. A mini app is installed from a marketplace like anyone's, so its own screens and their
captures belong to the repository that publishes it; nothing here imports a mini app's code or opens
its workbench. Where a Store scenario needs mini apps, it uses whichever ones the catalog lists and
names none.

## Start an isolated demo

```bash
bun run screenshots:prepare
```

Use the command the script prints to start `bun scripts/dev-servers.mjs` in another terminal: an
isolated database, ports, and `HOME=<capture-root>/home`. This launcher supplies both HTTP and
WebSocket origins. Never point the capture runner at the personal application on port 5050.

```bash
bun run screenshots:seed
```

Seeding is repeatable: it keeps one project and its conversation, plus the transcript fixtures the
chat scenarios open. The runtime verifier compares the temporary database identity with both its
descriptor and the running API, refuses another database, and refuses an API whose `HOME` is outside
the capture root. The seed installs every mini app the Store's catalog lists into that home, as a
person installs one, and switches on the demo agents a fresh database finds in the fixture project.
Data stays outside the repository.

A failed seed can leave partial fixtures. In particular, the disposable Git repository inherits
commit signing and its initial commit can time out. Rerunning skips initialization when `.git`
exists, so a successful rerun does not prove that commit was created. Before a Git capture, verify
that `git -C <fixture-project> rev-parse --verify HEAD` succeeds. Resolve signing and prepare a new
dedicated capture directory if the initial commit is missing; leave personal Git settings intact.

Install the browser once:

```bash
bunx playwright install chromium
```

Alternatively, set `CAPTURE_BROWSER` to an installed Chrome executable. `LOCALIX_CAPTURE_ROOT` can
select another dedicated `localix-…capture…` directory beneath the system temporary directory.

## Local models and semantic search

`local-models/settings` and `search/meaning-match` are opt-in: they need the pinned embedding model
in a dedicated models folder, and never download one or read a person's own `~/.localix/models`.
Clone the runtime and the embedding model into the capture root, then start the isolated API with
`LOCALIX_MODELS_DIR` pointing there:

```bash
M=<capture-root>/models; mkdir -p $M/models $M/runtime
cp -cR ~/.localix/models/runtime/b11600 $M/runtime/
cp -cR ~/.localix/models/models/ggml-org--embeddinggemma-2-GGUF--Q8_0 $M/models/
LOCALIX_MODELS_DIR=$M LOCALIX_DB_FILE=<capture-root>/localix.db … bun scripts/dev-servers.mjs
LOCALIX_CAPTURE_LOCAL_MODELS=1 bun run test:screenshots --grep 'local-models/|search/meaning'
```

The seed turns semantic search on and waits for the real index. The query shares only stopwords with
the matched fixture message, so the hit is the model's work; how it was found is not shown. Both
scenarios start from the workspace (`start` in `plan.mjs`) rather than an open conversation.

## Store evidence

The `store/*` scenarios need a home of their own. A person's Store has a few mini apps installed and
the rest on offer, while the seed above installs every one for the All tools menu, so the Store runs
against a second capture runtime whose API has its own `HOME`:

```bash
R=<capture-root>   # a dedicated localix-…capture… directory, as above
mkdir -p $R/home
HOME=$R/home LOCALIX_CAPTURE_ROOT=$R LOCALIX_DB_FILE=$R/localix.db LOCALIX_DEV_API_PORT=5151 \
  LOCALIX_DEV_UI_PORT=5150 VITE_DEV_HOST=127.0.0.1 bun scripts/dev-servers.mjs
LOCALIX_CAPTURE_ROOT=$R bun run test:screenshots --grep 'store/'
```

Each Store scenario runs `store-seed.mjs` first: it writes the fixture the runner opens and, in a
home with no mini app installed, installs the first three mini apps of the catalog (by id) through
the Store. It never removes anything, so against a home that holds other mini apps the scenarios
fail their count of three rather than uninstall a person's apps. `store/listing` opens the first
mini app of the catalog that has pictures and a screen of its own. The browser has no macOS shell,
so the desktop app (**Install as app**) is not offered in these captures; its DOM tests cover it.

The mini app catalog, the plugin shelves, Sources and the consent sheet come from the default
sources, which the runtime reads over the network when it starts, so it needs the network, and the
scenarios assert what any answer looks like rather than a named package. To look at the Store at
another width or theme, set `LOCALIX_CAPTURE_VIEWPORT=2000x1100` (the pane is about 60% of it) and
`LOCALIX_CAPTURE_THEME=light` and read the run directory; publishing needs the native 1600×1000
capture, so those runs are for review only.

## Composer surfaces and recommendations

`composer/status-line`, `composer/mcp-prompts`, `composer/plugin-waiting` and `store/for-your-work`,
`store/for-your-work-all` run in a Store-style runtime (own `HOME`,
`bun scripts/screenshots/store-seed.mjs` once for its fixture) that is also **offline**: start it
with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `TURBO_ENV_MODE=loose` (Turborepo otherwise
drops the variable before it reaches the API), and clone the embedding model into its `HOME` as in
the local models section. No plugin marketplace is read, so the recommendation answer is the same on
every run; the scenarios assert that nothing is installed, third-party, labelled Community or
unreadable.

The composer ones seed a folder of their own, `claude-code-surfaces`, so no other capture shows
them: its `.claude/settings.json` has a `statusLine` command, `.localix/plugins/release-helper` is a
plugin that waits for its OK, and a project MCP server (`mcp-prompts-server.mjs`, started by the
runtime) is connected through the Store's own **Test connection** so its prompts reach the slash
menu. `agents/context-and-limits` needs the demo agents (`demo-agents.mjs`) and a fresh
`/agents list` in the fixture conversation; it maximizes the Store pane so the chat beside it stays
out of the image.

Not captured: the **Recommended for you** row above the composer (it shows only when meaning finds a
match, and a catalog of Localix's own mini apps rarely clears the semantic gate for a fixed working
set, so it cannot be made deterministic without a live marketplace); the language-server install
status and Stop returning queued messages (they need a genuinely running install or run).

## Demo HTTP responses

The optional runner starts a small Bun HTTP fixture on `127.0.0.1:5160` for the browser preview.
Docker is not required. It serves only the demo HTML and release-status JSON, and closes its
listener after the run succeeds or fails. An existing fixture server is reused only if its identity
matches the same isolated project; an unrelated service on that port is left running and the capture
run stops with an explanation.

To inspect the fixture independently, run `bun scripts/screenshots/fixture-service.mjs` in another
terminal. Stop it when finished.

## Test, review, update

```bash
bun run test:screenshots
bun run test:screenshots --grep 'agents/context-and-limits'
bun run screenshots:publish
bun run --cwd apps/landing generate
```

The test runner prints its review directory. Each PNG has a sidecar recording its semantic key,
date, purpose and passing assertions. A failed scenario writes no publishable capture. Traces for
failed cases remain in the temporary test-results directory. Review the image at full size before
publishing it; the sidecar proves the test passed, not that the composition is good.

For an intentional refresh of already reviewed compositions:

```bash
bun run screenshots:update --grep 'agents/context-and-limits'
```

This runs the tests, publishes only if the run succeeds, updates existing dated screenshot
references across public guides, then generates the landing. New screenshots still need an author to
choose the relevant place in the guide. Do not insert an image into every reference page.

```bash
bun run screenshots:audit
```

The audit prints current files, dimensions and placement, and creates a local visual contact sheet.
It labels historical comparisons separately; they are excluded from the public asset manifest.

## Stable names and useful evidence

`plan.mjs` records what each shot proves, its owning guide and its scenario. Keep the semantic key
stable (`agents/context-and-limits`); the date changes independently. Publish uses exactly that key
for the directory, PNG filename and Markdown references. Avoid `screenshot-1`, `new`, `final`,
viewport dimensions in the name, and duplicate keys for the same evidence.

When a feature's visible behavior changes, update its scenario and assertions in the same change.
For a new visual feature, add a scenario, deterministic fixture data, an evidence check and a
purpose/guide entry. Prefer the user's action and its result: a slash menu listing the connected
server's prompts, a Store page with its consent sheet, a restarted terminal. Wait for rendered
content, including PDF canvases and lazy dialogs. A loading indicator disappearing before it mounts
is not proof of readiness. Use native controls to maximize a panel, resize a split, filter rows and
position the camera.

A fixture transcript is illustrative content, not evidence of a model run. The test output in the
editor is produced by actually running the fixture's tests. Do not depict live jobs, connections or
CLI sessions unless they are genuinely running. Reserved slots for unavailable scenarios remain
unpublished; empty or invented screens do not fill the gap.

`workspace/session-window-drag` advertises native destinations through the typed UI port, then
performs a sidebar drag. It verifies equal material thickness, aligned starts, symmetric spacing,
and the shared glass coat. Native window creation is stubbed; this capture proves the UI geometry,
not an AppKit handoff.

## Optional CLI evidence

The external-agent terminal scenario is skipped unless `LOCALIX_CAPTURE_CLAUDE=1`. It needs an
installed `claude` executable that supports `--bare`. The scenario launches it with a fresh,
unauthenticated fixture configuration, removes API-key and auth-token environment variables, and
opens its native startup screen. It uses no personal CLI session, account or model call.

```bash
LOCALIX_CAPTURE_CLAUDE=1 bun run test:screenshots --grep 'external-agents/history'
```

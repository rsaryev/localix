# Optional UI tests and product captures

Run these Playwright tests deliberately. They are excluded from Bun's normal discovery and are not
part of CI. Each scenario performs real UI actions, checks the result, and only then writes a native
4800×3000 PNG. No DOM replacement, CSS recoloring, pixel retouching, provider credentials or model
calls are needed.

## Start an isolated demo

```bash
bun run screenshots:prepare
```

Use the isolated database and port command printed by the script to start
`bun scripts/dev-servers.mjs` in another terminal. This launcher supplies both HTTP and WebSocket
origins. Never point the capture runner at the personal application on port 5050.

```bash
bun run screenshots:seed
```

Restart the capture workspace after the first seed so the backend restores the durable demo
question. Seeding is repeatable: it keeps one project, conversation, resume, database and component
board. The runtime verifier compares the temporary database identity with both its descriptor and
the running API, and refuses another database. Data stays outside the repository.

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

## Demo HTTP responses

The optional runner starts a small Bun HTTP fixture on `127.0.0.1:5160` for the browser preview and
API Client request. Docker is not required. It serves only the demo HTML and release-status JSON,
and closes its listener after the run succeeds or fails. An existing fixture server is reused only
if its identity matches the same isolated project; an unrelated service on that port is left running
and the capture run stops with an explanation.

To inspect the fixture independently, run `bun scripts/screenshots/fixture-service.mjs` in another
terminal. Stop it when finished. The Docker scenario below can serve the same fixture instead; its
marker identifies that mounted project, and the runner leaves the reused container running.

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
bun run screenshots:coverage
```

The audit prints current files, dimensions and placement, and creates a local visual contact sheet.
It labels historical comparisons separately; they are excluded from the public asset manifest.
Coverage checks each of the 18 workbench owners against its scenario, native capture and owning
guide. DevOps has an additional Kubernetes check: a Docker capture does not prove that provider.

## Stable names and useful evidence

`plan.mjs` records what each shot proves, its owning guide and its scenario. Keep the semantic key
stable (`agents/context-and-limits`); the date changes independently. Publish uses exactly that key
for the directory, PNG filename and Markdown references. Avoid `screenshot-1`, `new`, `final`,
viewport dimensions in the name, and duplicate keys for the same evidence.

When a feature's visible behavior changes, update its scenario and assertions in the same change.
For a new visual feature, add a scenario, deterministic fixture data, an evidence check and a
purpose/guide entry. Prefer the user's action and its result: a query with rows, a completed resume
beside its fields, a populated task board. Wait for rendered content, including PDF canvases and
lazy dialogs. A loading indicator disappearing before it mounts is not proof of readiness. Use
native controls to maximize a panel, resize a split, filter rows and position the camera.

A fixture transcript is illustrative content, not evidence of a model run. The test output in the
editor is produced by actually running the fixture's tests. Do not depict live jobs, connections or
CLI sessions unless they are genuinely running. Reserved slots for unavailable scenarios remain
unpublished; empty or invented screens do not fill the gap.

`workspace/session-window-drag` advertises native destinations through the typed UI port, then
performs a sidebar drag. It verifies equal material thickness, aligned starts, symmetric spacing,
and the shared glass coat. Native window creation is stubbed; this capture proves the UI geometry,
not an AppKit handoff.

## Game evidence

Game captures use legal saved demo positions validated by each plugin's shared rules. Chess and
Checkers begin after four scripted plies, then select a piece to show legal destinations.
Tic-Tac-Toe starts after four scripted moves and a real click completes the winning row. Battleship
starts with scripted hits and misses on both boards; a real shot sinks a ship while retaining the
human turn. 2048 starts in **I play** mode and uses real arrow keys to merge tiles. Its assertions
wait until the rendered tiles match the saved board before capturing the image.

These are illustrative positions, not recorded model games. The other four games retain their real
agent-opponent UI; no human-versus-human mode is invented, and the scenarios never wake a model.
Each scenario resets its own isolated game state so reruns keep the same starting position.

## Kanban evidence

The two Kanban scenarios seed four cards in the dedicated fixture chat and move the release-notes
card from Backlog to Ready with a real keyboard action. They check the persisted status, owners and
full card visibility before capture. Empty columns are collapsed through the UI. Seeding verifies
the runtime identity, chat's project and canonical project root, and refuses a board containing
unrelated cards. Done cards and the adjacent transcript are illustrative, not recorded agent work.

## Optional Docker evidence

The container scenario is skipped unless `LOCALIX_CAPTURE_DOCKER=1`. Start a dedicated container
using the fixture project directory printed by the preparation step:

```bash
docker run -d --name localix-capture-preview --label localix.capture=true \
  --publish 127.0.0.1:5160:80 \
  --mount type=bind,source=<fixture-project>,target=/usr/share/nginx/html,readonly nginx:alpine
LOCALIX_CAPTURE_DOCKER=1 bun run test:screenshots --grep 'devops/containers'
docker rm -f localix-capture-preview
```

The scenario filters the real inventory to this container before capture. Never publish unrelated
container names, logs, host paths or service configuration. Stop the capture servers and container
when finished; leave the user's existing servers alone.

## Optional CLI evidence

The external-agent terminal scenario is skipped unless `LOCALIX_CAPTURE_CLAUDE=1`. It needs an
installed `claude` executable that supports `--bare`. The scenario launches it with a fresh,
unauthenticated fixture configuration, removes API-key and auth-token environment variables, and
opens its native startup screen. It uses no personal CLI session, account or model call.

```bash
LOCALIX_CAPTURE_CLAUDE=1 bun run test:screenshots --grep 'external-agents/history'
```

## Optional Kubernetes evidence

The pod-log scenario is skipped unless `LOCALIX_CAPTURE_KUBERNETES=1`. It requires Docker, `k3d` and
`kubectl`. Create a dedicated cluster and write its kubeconfig inside the temporary capture
directory printed by `screenshots:prepare`. These commands leave the default kubeconfig and its
current context unchanged:

```bash
LOCALIX_CAPTURE_KUBECONFIG='<capture-directory>/kubeconfig'
k3d cluster create localix-capture --servers 1 --agents 0 --no-lb \
  --api-port 127.0.0.1:5161 \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false
k3d kubeconfig get localix-capture > "$LOCALIX_CAPTURE_KUBECONFIG"
kubectl --kubeconfig "$LOCALIX_CAPTURE_KUBECONFIG" create namespace release-studio
kubectl --kubeconfig "$LOCALIX_CAPTURE_KUBECONFIG" --namespace release-studio \
  create deployment release-preview --image=nginx:alpine
kubectl --kubeconfig "$LOCALIX_CAPTURE_KUBECONFIG" --namespace release-studio \
  rollout status deployment/release-preview --timeout=120s
```

Start or restart the isolated capture workspace with `KUBECONFIG="$LOCALIX_CAPTURE_KUBECONFIG"`
alongside the database and port variables printed by `screenshots:prepare`. The API must receive
this variable; setting it only on the test runner does not isolate the API's Kubernetes inventory.

```bash
LOCALIX_CAPTURE_KUBERNETES=1 bun run test:screenshots --grep 'kubernetes/pod-logs'
k3d cluster delete localix-capture
```

Delete only the `localix-capture` cluster created for these tests. Stop the isolated API before
removing its kubeconfig; leave other clusters and the default kubeconfig untouched.

## Public market evidence

Trading captures read actual public BTC/USD candles from Kraken. They require outbound network
access, without a venue account or trading credentials. Assertions verify the returned candles
before capturing the chart. If the public endpoint is unavailable, rerun when it recovers; do not
replace its response with invented market data.

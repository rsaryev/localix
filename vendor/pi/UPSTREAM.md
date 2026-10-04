# Vendored pi runtime

This directory contains the four pi packages used by Localix's pi runtime adapter.
They remain isolated behind `@localixai/agent-runtime-pi`; Localix application code
must depend on the engine-neutral contracts in `@localixai/agent` instead of importing
these packages directly.

- Upstream: <https://github.com/earendil-works/pi>
- Base commit: `200387122ca450d6387f033949423114a270b96c`
- Upstream version: `1.0.2`
- Vendored packages: `packages/ai`, `packages/agent`, `packages/chord`, `packages/telemetry`
- License: MIT; see [`LICENSE`](./LICENSE)

`chord` and `telemetry` are not used by Localix directly. They are vendored because
`packages/agent` imports both (`harness/context.ts`, `harness/session/types.ts`,
`src/index.ts`) and `packages/ai` imports `telemetry` from `src/types.ts`, so the
package cannot type-check without them.

## Local delta

The package manifests are marked private and add a `type-check` script the monorepo graph
runs. The regular build compiles the checked-in model
catalog without fetching mutable external APIs; `generate-models` (full regeneration) and
`hydrate-model-data` (`src/providers/data/` only) remain available as explicit maintenance
commands. Upstream gitignores `packages/ai/src/providers/data/`; Localix checks it in, and
`check:model-data` — which the offline build runs — is what proves the checked-in data still
matches the generated catalog. No upstream package names are changed; the intentional
Localix API extensions are documented below.

Local workspace dependencies use `workspace:*` so a version mismatch can never silently
fall back to the public npm packages.

`packages/agent` has a Localix-only `AgentContext.modelTools` extension. `modelTools` is
the tool-schema list sent to the model, while `tools` remains the complete runtime dispatch
list. The split lets Localix keep deferred or otherwise hidden tools executable without
exposing their schemas before activation. Preserve both the type and the
`context.modelTools ?? context.tools` selection when re-vendoring — since `509ee2b` that
selection lives in `declareToolChanges`, which writes the roster onto a transcript system
message rather than onto the request, so the delta moved with it. The
`uses modelTools for schemas while retaining hidden tools for runtime dispatch` test in
`packages/agent/test/agent-loop.test.ts` is the conformance tripwire for this contract; it
reads the declaration back with `getCurrentTools(ctx.messages)`, which is where the model's
view of the roster now comes from.

Tool progress emission also has a Localix backpressure guard: each running tool keeps at
most the update currently being delivered and the newest pending snapshot. Preserve the
coalescing pump in `executePreparedToolCall`; its burst regression in
`packages/agent/test/agent-loop.test.ts` prevents an unbounded Promise array from being
reintroduced when re-vendoring.

The OAuth browser pages in `packages/ai/src/utils/oauth-page.ts` are restyled for Localix and
render the mark in `packages/ai/src/utils/localix-logo.ts` (upstream moved the page there from
`auth/oauth/`; the mark moves with it). Both files are Localix-owned: re-vendoring must keep
them, not restore pi's pages.
`packages/ai/test/oauth-page.test.ts` is their guard and runs in the regular test graph.

`packages/ai/src/api/anthropic-messages.ts` carries the Localix cache-anchor extension: a
`cacheAnchor`-marked message gets an explicit prompt-cache breakpoint after the last
byte-stable message, so a rebuilt history is read from cache up to there while only the
volatile tail is written. The OAuth identity block gives up its own breakpoint when a system
prompt follows it, because Anthropic rejects a fifth breakpoint. `convertMessages` is
exported for this; `packages/agent-runtime-pi/src/cache-anchor.test.ts` is the guard.
`cacheAnchor` is declared on every transcript message type in `packages/ai/src/types.ts`,
`SystemMessage` included — a system message became a transcript position at `509ee2b`
(mid-conversation instructions and tool changes), so it can be the last stable one too.

The Codex Responses transport registers one atomic cleanup with pi's engine-neutral session
resource registry (`cleanupOpenAICodexSessionResources`). It closes cached WebSockets (which
own continuation state) and clears both debug counters and the sticky WebSocket-to-SSE
fallback for the disposed session. Preserve the disposal regression in
`openai-codex-stream.test.ts`; registering only the socket closer leaks session behavior
across deletion and same-id reuse.

`packages/ai/src/utils/validation.ts` recovers a STRINGIFIED structured argument. The tool-call
protocol already carries `arguments` as a JSON string, so a model that mixes up the two encoding
levels quotes a nested object or array one time too many: the outer parse succeeds and the inner
value stays a string. pi tolerated the stringified form of every scalar type but not of `object` or
`array`, so a tool whose parameter is an object was unreachable for such a model — validation failed
before the tool ran, once per union branch. `parseStructuredString` sits beside the structural
coercion (it reshapes a value rather than converting a primitive, so it does not belong in
`coercePrimitiveByType`) and runs before the per-property descent. It accepts only a string that
parses to a type the schema asks for, and never rewrites a value a schema already accepts as a
string. `packages/agent-runtime-pi/src/tool-argument-coercion.test.ts` is the tripwire and drives
the real bridge. Proposed upstream; drop this when it lands there.

The Codex OAuth login carries the official Codex CLI's stale-login recovery behavior: a new
attempt cancels the previous callback listener, retries the preferred port, and falls back to
the second registered callback port. Since upstream moved every provider onto one loopback
server (`packages/ai/src/auth/oauth/callback-server.ts`), the delta is two parts: that server's
`cancel` option (a `/cancel` route that rejects the wait and releases the port), and
`startCodexCallbackServer` in `openai-codex.ts` (the bind loop over 1455 and 1457, and the
authorize URL and code exchange naming the redirect actually bound). Preserve the overlapping
browser-login regression in `openai-codex-oauth.test.ts` until upstream pi has equivalent
listener lifecycle handling.

## Keeping the catalog fresh

For maintainers, `.githooks/pre-commit` regenerates `packages/ai/src/providers/` before a commit
and stages the result, so a commit never carries a catalog older than itself. The hook only acts
when `LOCALIX_MAINTAINER=1` is set, so an outside contributor's commit is never touched by it. It
is wired up by the root `prepare` script (`git config core.hooksPath .githooks`), which
`bun install` runs. It validates the refresh with `check:model-data` and reverts a regeneration
that fails, and it never blocks a commit: models.dev and the provider APIs are third-party, so an
offline commit just keeps the catalog it has. `LOCALIX_SKIP_MODEL_CATALOG=1` skips it.

The regular monorepo test graph runs the vendored OAuth page and OpenRouter OAuth tests
only. Full upstream suites remain available through `test:upstream`; run them with pi's
credential sanitization procedure before updating the snapshot.

The upstream-only `canvas` devDependency is omitted. It is used solely by the manual
`generate-test-image.ts` fixture script; installing it in the application workspace makes
`linkedom` activate its optional native canvas peer and breaks Bun's desktop sidecar bundle.

### Adopted upstream since the previous snapshot

These were Localix deltas at `0.80.10` and are now upstream, so they carry no local diff:
the native OpenRouter OAuth PKCE flow (`auth/oauth/openrouter.ts`, its loader registration
and its test), the `credential.env` passthrough in `envApiKeyAuth` and the Bedrock resolver,
the Codex `cacheRetention: "none"` isolation of prompt-cache keys / SSE affinity / WebSocket
reuse / continuation state, and the canonical 272k context window for the GPT-5.6 Codex
variants. At `d6af72e1` upstream also builds with `tsc` instead of its root-level `tsgo` binary and
maps `@google/genai`'s `FinishReason.TOO_MANY_TOOL_CALLS` itself, so both of those deltas are gone; the Localix `type-check` and `test`/`test:upstream` scripts sit
beside upstream's lines rather than replacing them.

### What `509ee2b` changed for the host

Upstream moved the SYSTEM PROMPT and the TOOL ROSTER out of the request and into the
transcript: a run's instructions are its leading system message, and a turn declares tool
changes on a system message (`toolsAdded` / `toolsRemoved`). `Context` became the branded
`TranscriptContext`, built with `normalizeContext`, and `AgentContext.systemPrompt` is gone.
`packages/ai/src/utils/deferred-tools.ts` and its test were deleted upstream and are dropped
here too — nothing referenced them after the refactor.

The adapter moved with it, and these three are what a future re-vendor must not undo:
`runtime.ts` prepends `toPiSystemMessage(input.systemPrompt)` to the transcript; its
`transformContext` carries pi's system messages through compaction untouched (losing the
prompt would be silent, while a dropped tool declaration is re-derived next turn); and
`pi-transcript.ts` states which pi messages reach the provider (all of them, system
included) versus which have an engine-neutral counterpart (never system). The assertion that
the prompt and roster actually reach the model is
`the system prompt and the tool roster reach the model as transcript messages` in
`packages/agent-runtime-pi/src/runtime-scripted.test.ts`.

## Updating

`bun run vendor:sync` performs the update, as its own commit. For maintainers who set
`LOCALIX_MAINTAINER=1`, `.githooks/pre-commit` detects that upstream moved and stops the commit
until it is synced (see [AGENTS.md](../../AGENTS.md) for the rule).

Upstream arrives as a SNAPSHOT commit (`scripts/vendor-pi/snapshot.ts`): exactly the four vendored
packages at one upstream commit, with the manifest policy applied (`workspace:*`, `private`, and
every script Localix set differently from upstream — `scripts/vendor-pi/manifest-policy.ts`), so
those decisions never re-conflict. Snapshots chain through their parents and are deterministic, so
two machines syncing the same upstream produce the same commit. `main` merges the snapshot with a
real `git merge`: the base is the previous snapshot, found in history by its `Vendor-Upstream`
trailer; renames are detected; markers are `zdiff3`; `rerere` replays a resolution made once. A
conflict is an ordinary unmerged path — the sync prints the paragraph of this file that names it —
and `bun run vendor:sync:continue` finishes once it is resolved: `bun install` when a vendored
dependency moved, every delta guard in `scripts/vendor-pi/config.ts` under its package's own
runner, the base commit and version recorded above, then the merge commit.

After a successful sync the script prints what upstream changed and the `gh` commands that read
it. That report is the work, not a formality: a merge that compiles says the fork survived, not
that Localix adopted anything. Read the range, then decide whether a new provider capability
belongs in `packages/agent-runtime-pi`, whether a delta below has become upstream (move it to
"Adopted upstream" and delete the local diff), and whether anything user-visible needs a `docs/`
page in the same commit.

The snapshot is source only, and it enforces one exclusion: `packages/agent/docs/pico/`
(upstream's design handoffs and working notes, which at `59eb4c39` included a zip of a harness
draft) is never taken. The sync that first carried that path pushed `vendor/pi` through the size
ceiling in `scripts/vendor-boundary.test.ts`; the same test now fails if the path or any archive
comes back. Add to `PRUNED` in `scripts/vendor-pi/config.ts` when upstream grows another such
tree — never raise the ceiling for it.

When a native or optional peer dependency changes, check the desktop sidecar bundle after the sync.
With `LOCALIX_MAINTAINER=1`, the pre-commit hook's second half refreshes the checked-in model
catalog on the next commit.

# Vendored pi runtime

This directory contains the four pi packages used by Localix's pi runtime adapter.
They remain isolated behind `@localixai/agent-runtime-pi`; Localix application code
must depend on the engine-neutral contracts in `@localixai/agent` instead of importing
these packages directly.

- Upstream: <https://github.com/earendil-works/pi>
- Base commit: `06a466935536f8c9bcacb2d5efc0fc021be1bdff`
- Upstream version: `1.2.0` (tag `v1.2.0`)
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

`LoginOptions.agentName` (the host display name) is upstream since `1.2.0`: the ChatGPT flow sends it as
`agent_name_hint` and the Codex flow as `originator`. The only Localix residue is that
`openai-chatgpt.ts` trims it and falls back to Pi for blank values (upstream only falls back when
it is undefined), and `startCodexCallbackServer`'s `createAuthorizationFlow(state, redirectUri,
originator)` threads the name beside the bound redirect. Localix's auth adapter supplies
`Localix`. `packages/ai/test/openai-chatgpt-oauth.test.ts` (including the blank-name case) and
`packages/agent-runtime-pi/src/auth.test.ts` guard the flow and adapter respectively.

The generator's conversion (`packages/ai/src/generated-catalog/build.ts`, see below) skips
`opencode-go` models that resolve to
`google-generative-ai`. The generator reads live models.dev data, which can run ahead of the pinned
provider code; at `1.2.0` the `opencode-go` provider registers only the Anthropic, Completions and
Responses transports, so a Gemini entry failed `type-check`. Drop the skip when upstream's
`opencode-go.ts` registers the Google API.

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

The same file also words the validation failure the model reads to repair its call
(`formatValidationMessage`). TypeBox reports an unknown key twice — `schema is false` on the key and
`must not have additional properties` on its parent — and an enum miss without its allowed values.
The delta names unknown keys once (`unknown parameter "x" — not accepted here`) and lists allowed
enum values (`must be one of "a", "b"`); every other error keeps TypeBox's message. The same
tripwire file pins the wording.

For a union whose branches each fix one property to a constant (`action`, `op`), the error report
(`narrowForReport`) checks only the branch the call names, walking nested objects and arrays. When
the call names no branch, the report lists the allowed discriminator values. TypeBox reports a miss
against every branch and prints the first one, usually the wrong one: an `init` call with one bad
nested field read as the `guide` branch's `unknown parameters` complaint, and the model dropped its
content. Validation itself is unchanged; only the message is narrowed.

The Codex OAuth login carries the official Codex CLI's stale-login recovery behavior: a new
attempt cancels the previous callback listener, retries the preferred port, and falls back to
the second registered callback port. Since upstream moved every provider onto one loopback
server (`packages/ai/src/auth/oauth/callback-server.ts`), the delta is two parts: that server's
`cancel` option (a `/cancel` route that rejects the wait and releases the port), and
`startCodexCallbackServer` in `openai-codex.ts` (the bind loop over 1455 and 1457, and the
authorize URL and code exchange naming the redirect actually bound). Preserve the overlapping
browser-login regression in `openai-codex-oauth.test.ts` until upstream pi has equivalent
listener lifecycle handling.

Two catalog-generator deltas, both upstream-shaped and both regenerated into
`packages/ai/src/providers/`:

- **`Model.releaseDate`** (`src/types.ts`, optional `YYYY-MM-DD`). The conversion (`src/generated-catalog/build.ts`)
  records models.dev `release_date` for every models.dev entry under its own provider key, and under
  the pi provider/id at each `recordModelsDevReasoningOptions` site (and the Qwen Token Plan loop),
  so providers read from a differently named source (`zai` ← `zai-coding-plan`, `fireworks` ←
  `fireworks-ai`, `cloudflare-ai-gateway`'s rewritten ids, …) get their own dates. Hand-written
  `openai-codex` models read OpenAI's dates (`RELEASE_DATE_ALIASES`); the Azure copies inherit them
  by spread. OpenRouter models take OpenRouter's `created` (`src/generated-catalog/openrouter-catalog.ts`) and AI
  Gateway models its `released`, else `created`. Month-only dates (`2025-10`) become the first of the
  month; anything else is left unset (`src/generated-catalog/release-dates.ts`). Localix orders its picker
  newest-first on it.
- **`off` for thinking-toggle formats** (`applyToggledOffThinkingMetadata`). For chat-completions
  models whose resolved `thinkingFormat` is `zai`, `qwen`, `qwen-chat-template` or `together`, the
  request switches thinking off with an explicit flag whenever no level is sent, so an `off: null`
  derived from an effort list without `"none"` was wrong: `getSupportedThinkingLevels()` hid Off and
  `clampThinkingLevel()` turned Off into reasoning. The generator drops that null.
  `packages/agent-runtime-pi/src/catalog-reasoning.test.ts` is the tripwire for both.

### Runtime catalog refresh

Localix refreshes the built-in providers' models at runtime through pi's own `Models.refresh()`,
with the generator's conversion. Six changes, all in `packages/ai`, all upstream-shaped:

1. **The conversion moved from `scripts/` into `src/generated-catalog/`.** `build.ts` holds what
   `generate-models.ts` did between fetching and writing — every constant, `process*` function,
   models.dev / OpenRouter / AI Gateway / NVIDIA / classifier converter and the combine and
   post-processing pass — as one pure, synchronous `buildGeneratedCatalog(sources, { strict, logger })`
   returning JSON values. The code is moved, not rewritten: the converters that used to fetch
   inline (`fetchAiGatewayModels`, `loadModelsDevData`, `loadModelsDevClassifierModels`, the NVIDIA
   id map) lost their fetch and try/catch, which `convertSource` now applies with the same
   strict/non-strict policy; the module-level `modelsDevReasoningOptions` / `modelsDevReleaseDates`
   maps are cleared around each build. The helpers `ai-gateway-pricing.ts`,
   `models-dev-reasoning-options.ts`, `openrouter-catalog.ts`, `openrouter-reasoning-options.ts` and
   `release-dates.ts` moved with it, and `assertExactModelIds` moved to `model-ids.ts`
   (`scripts/model-data.ts` re-exports it). Compiling it under `src/`'s strict `tsc` needed only
   type-level edits: two `AnthropicMessagesCompat` casts, an index cast for the Copilot overrides,
   two non-null assertions, and `OpenAICompletionsResolvedCompat` declared as a type (the default
   compat object lacked `sessionAffinityFormat`/`vllmPriority`) instead of derived from a
   `satisfies`. `sources.ts` names the source URLs and fetches documents, conditionally when a
   previous response carried an `ETag`/`Last-Modified`. `scripts/generate-models.ts` now fetches
   the documents (same order, logs and `--strict` policy), calls `buildGeneratedCatalog`, and keeps
   its output stage unchanged. Over the same seven live documents the old and new generator wrote
   byte-identical JSON. One visible difference: every source is fetched before any conversion runs,
   so `test/generate-models-strict.test.ts`'s fetch mock now answers the other sources too.
2. **`refresh.ts`**: `GeneratedCatalogRefresher` (one shared build per refresh, in-memory
   revalidation of documents that carry a validator, a six-hour freshness check on
   `context.stored.checkedAt`, strict build) and `withGeneratedCatalogRefresh(provider, refresher)`.
   Exported as the `@earendil-works/pi-ai/generated-catalog` entry point (`package.json` `exports`).
3. **`models.ts`**: `createProvider`'s restore/fetch/publish overlay is factored into
   `dynamicModelList`, reused by the new `withDynamicModels(provider, { fetchModels,
   refreshWithoutAuth })`, which makes an existing static provider dynamic. `fetchModels` may
   resolve `undefined` to keep the current list and stored entry (a fresh catalog).
4. **`Provider.refreshWithoutAuth`**: `Models.refresh()` runs the network phase of such a provider
   without a configured credential (`context.credential` is then undefined). A public catalog needs
   none, and Localix's credentials are per connection, not per provider.
5. **`ModelsRefreshResult.updated`**: the provider ids whose list a publication replaced during the
   refresh, restores included — the signal a reader that caches a projection invalidates on.
6. **`src/providers/model-entry-schema.ts`**: TypeBox schemas for chat, image and classifier model
   entries and `ModelsStoreEntry`, composed from `model-schema.ts` and `compat-schema.ts`, and
   `isModelsStoreEntry()`, which a `ModelsStore` backed by external storage uses to drop bad entries.

`packages/ai/test/generated-catalog.test.ts` is the guard: it runs `generate-models --strict` over
fixture documents and asserts that its `models.all.json` equals `buildGeneratedCatalog` and the
runtime refresher's output, and covers the 304 path, the shared build, the freshness check, restore
without network, failure keeping the previous list, and the schema. On a re-vendor, keep the
generator a thin caller of `buildGeneratedCatalog`: a change upstream makes to `generate-models.ts`
between its fetches and its output stage belongs in `src/generated-catalog/build.ts`.

## Keeping the catalog fresh

For maintainers, `.githooks/pre-commit` regenerates `packages/ai/src/providers/` before a commit
and stages the result, so a commit never carries a catalog older than itself. The hook only acts
when `LOCALIX_MAINTAINER=1` is set, so an outside contributor's commit is never touched by it. It
is wired up by the root `prepare` script (`git config core.hooksPath .githooks`), which
`bun install` runs. It validates the refresh with `check:model-data` and reverts a regeneration
that fails, and it never blocks a commit: models.dev and the provider APIs are third-party, so an
offline commit just keeps the catalog it has. `LOCALIX_SKIP_MODEL_CATALOG=1` skips it.

The regular monorepo test graph runs the vendored OAuth page, OpenRouter OAuth and generated
catalog tests only. Full upstream suites remain available through `test:upstream`; run them with pi's
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

### Notes on the `1.2.0` snapshot

`packages/chord` was restructured upstream (the `services`/`bundler` surface was replaced by
`context`, `delta`, `facets`, a node loader and a WebSocket link; it now depends on `typebox` and `ws`
instead of `esbuild`). Localix does not import it directly. `packages/ai` renamed the
`azure-openai-responses` provider to `azure` (its checked-in data file is `data/azure.json`), and
`AssistantMessage`/`ToolResultMessage` gained `durationMs`. The `AgentContext.modelTools`, progress
pump, steering probe and mixed scheduler deltas were carried onto the new `executePreparedToolCall`
(which now also measures `durationMs`). The delta tests build streams with
`createAssistantMessageEventStream` because upstream deleted the test-local `MockAssistantStream`.

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

`packages/agent` adds the Localix `AgentLoopConfig.shouldDeferToolCalls` probe. It is checked
before each tool call of an assistant message starts; when it reports a waiting steering message,
the unstarted calls are returned unrun with a "re-issue if still needed" result, so a person's
message reaches the model before the rest of a batch the model chose without reading it. Calls
already running finish. Preserve the probe in both `executeToolCallsSequential` and the
admission loop of `executeToolCallsMixed`; the `defers unstarted … tool calls while a steering
message waits` tests in `packages/agent/test/agent-loop.test.ts` guard it.

`packages/agent` replaces upstream's all-or-nothing tool batch with a mixed scheduler
(`executeToolCallsMixed` in `src/agent-loop.ts`), modelled on Codex's read/write lock. Upstream
ran a whole assistant turn sequentially as soon as one call's tool was `executionMode:
"sequential"`, so one edit, bash or memory write serialized every read and search beside it.
Calls are still admitted one at a time in source order (steering probe, `tool_execution_start`,
validation and `beforeToolCall`), but a parallel call starts as soon as no earlier call it
conflicts with is still running. A sequential call is a barrier: it is admitted only after every
earlier call has finished, and nothing after it is admitted until it finishes. Two Localix
`AgentTool` fields refine the classification, both given the validated arguments:
`executionModeFor` (per-call mode, overriding `executionMode`; a throw counts as sequential) and
`executionScope` (`{ paths, writes }`). Parallel calls conflict only when one writes and their
paths overlap (equal, or one is an ancestor of the other), or when one writes and the other
declares no paths (unknown footprint). A writer without paths, or a throwing hook, runs as
sequential. `tool_execution_end` follows completion order; tool-result messages are emitted in
source order each time the batch drains (around a barrier and at the end), so an all-parallel
batch keeps upstream's parallel event contract and an all-sequential one its sequential contract.
`toolExecution: "sequential"` still selects `executeToolCallsSequential`. Termination
(`shouldTerminateToolBatch`), abort handling (a call still waiting on a conflict when the run is
aborted gets "Operation aborted"; nothing is admitted after an abort) and the progress-update
pump are unchanged. The `mixed tool scheduling` tests in `packages/agent/test/agent-loop.test.ts`
guard the loop, and `packages/agent-runtime-pi/src/tool-scheduling.test.ts` guards the bridge
that maps Localix's `executionModeFor`, `parallelScopePaths` and `mutates` onto these fields.

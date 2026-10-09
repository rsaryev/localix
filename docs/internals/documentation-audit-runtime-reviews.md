# Documentation audit: runtime content reviews

This record continues the [content reviews](documentation-audit-reviews.md) for runtime-facing
guides. The [audit scope](documentation-audit.md) tracks remaining work; these slices do not prove
completion of the repository-wide audit.

## Provider connection keys and catalog metadata

Compared provider key selection, credential hydration and refresh serialization, connection DTOs,
environment detection, model ownership/resolution, catalog metadata refresh, and catalog response
validation with the provider guide. Relevant implementation history includes `7d384c8`; the reviewed
key-selection and metadata owners otherwise originate in the initial commit.

Corrected the distinction between disabling the last enabled key and removing the only remaining
key. A temporary database probe confirmed that removing an enabled key while a disabled key remains
can leave no runnable key; disabling the last enabled key and removing the only key are refused. The
fixture used synthetic credentials and was removed after closing the database.

Documented that environment connections copy the current value into the vault and do not track
subsequent environment changes. Detection omits already-connected providers. Corrected the metadata
refresh description: catalog projection starts the fetch on demand, with a five-minute minimum gap
and no periodic timer. A fake-clock probe confirmed the repeat refresh at five minutes without
making network requests.

Thirteen focused existing tests passed across environment detection, key masking, metadata
publication, and catalog conditional responses. Full provider-browser interactions, participant
model/effort inheritance, auxiliary routing, and sign-in transports remain separate comparisons.

## Participant routes and auxiliary workloads

Compared route precedence, cached defaults, recent-route SQL, participant birth/reseating, delegated
session creation, title generation, and inline-assist model resolution. These reviewed owners have
no later implementation commits beyond the initial commit. Preserved model precedence while
qualifying the five-second default cache and higher-priority choices.

Corrected effort inheritance for participants joining existing conversations and distinguished
recent effort, ordered by session activity, from recent models, ordered by explicit selection. Added
workload-specific behavior: titles require an assigned enabled route; inline completion is initially
disabled, falls back on model-resolution failure, and requests effort off. The persisted Delegated
agents route has no consumer in current child creation: the tool supplies identities, and
participant birth snapshots parent routes. Removed the unsupported selection promise from the
provider and delegation guides. Fifty-five existing tests passed for model precedence, child birth,
inline resolution, and generated titles. Provider-browser UI and sign-in transports remain open.

## OAuth flow and credential replacement

Compared flow admission/retry/expiry, prompt adaptation, provider-and-label matching, key creation,
client completion polling, and return-to-model selection. Documented separate limits: 30 seconds for
the first event, a 15-minute in-memory server flow, and up to 40 client polls with a three-second
delay between attempts. Slow reads extend the client wait, and stopping it does not cancel the
server flow. Repeated login waits for same-user/provider adapter cleanup.

Documented limited prompt adaptation and corrected the assumption that reauthorization replaces a
credential. Same-provider, same-label login appends an enabled key at a higher numeric priority,
leaving an older enabled key selected. An isolated temporary database probe confirmed the actual
connection ID, two retained credentials, and selection of the old key, then removed its synthetic
fixture. Twenty-four existing tests passed across OAuth admission/persistence, polling, and app
return behavior. This proves contracts with fake adapters, not live third-party sign-in. Provider
browser interactions and transport-specific vendor OAuth details remain open.

## Auxiliary spend provenance and time attribution

Compared request pricing, credential classification, usage normalization, title/inline/hook writers,
ledger accumulation, and session summaries with the cost guide. Relevant history includes `7d384c8`
and the initial commit. Added prompt-hook calls and distinguished child verifier turns. Qualified
OAuth provenance: main turns classify by credential type, while current auxiliary usage lacks that
classification and defaults to estimated.

Documented that auxiliary rows and counts represent accumulated routing buckets, not individual
requests. The ledger retains the first timestamp when adding later cost, which limits daily and
range-filtered auxiliary spend accuracy. A temporary database probe confirmed the unchanged date,
increased cost, and exclusion by a later range, then removed the fixture. Thirty-nine focused
existing tests passed for pricing, normalization, rollup publication, accumulation, and kind
queries. Detailed workbench interaction and boot-reconciliation boundaries remain separate audit
work.

## Statistics filters, ranges, and recovery

Compared the Localix/External source switch, native panel state, usage hooks, UTC range helpers,
keyset log pagination, exact-session versus tree filters, and idle reconciliation. These reviewed
owners originate in the initial commit. Added the native-tab scope, mount-fixed rolling range
anchor, UTC hour/day buckets, and fifty-row paging; clarified that a Session filter excludes child
sessions.

Qualified per-agent attribution and boot recovery: repair reads stored ordinary-turn usage, protects
auxiliary rows, and cannot recreate missing auxiliary calls or reprice history. Messages missing
model/agent identity can fall back to the first participant. Fifteen existing tests passed for range
calculation, sliced recovery, reconciliation preservation, and session-tree filtering. Full live
workbench interaction and visual freshness remain separate evidence work.

## LSP diagnostics and executable discovery

Compared diagnostic formatting, matching/selection, plugin configuration, executable discovery,
lookup caches, initialization, and editor-request timeouts with the language-server guide. Corrected
post-edit diagnostics from introduced-error wording to the actual current snapshot, which can
include pre-existing errors. Added grouping, position/line/file caps and missing-severity behavior.

Documented host-side executable lookup and npm lookup order, sixty-second negative PATH caching, and
process-lifetime positive caching. Added initialization and ordinary request wait budgets.
Thirty-six existing tests passed for diagnostic grouping/bounds, lookup cache expiry, filename
matching, and plugin configuration. Full editor operations, language-specific startup, remote
execution behavior, reconnect flows, and visual evidence remain separate review work.

## LSP edit application and conflict boundaries

Compared workspace-edit normalization, same-session buffer lookup, fingerprint construction,
independent disk commits, format-only buffer behavior, and client result settlement. These owners
originate in the initial commit. Corrected the blanket open-file routing promise to the requesting
session's tracked documents; other sessions' open documents do not select that buffer path.

Documented text-only application, skipped workspace resource operations and attached commands,
independent writes, unreadable/no-op skipping, and the actual scope of concurrency guards. Buffer
fingerprints are prepared from then-current tracked text; LSP document versions are not preserved.
Disk hashes guard the local read/write interval, not the server's earlier computation. Fifty-three
existing tests passed for routing, normalization, partial failures, formatting, and text-edit order.
Full user-visible conflict presentation and editor lifecycle still need separate review evidence.

## LSP visibility, host boundary, and read recovery

Compared language-service host wiring, local process spawning, session file-environment selection,
visible-editor synchronization, reconnect handling, and the shared read retry helper. Relevant
editor extraction history includes `e701dcd` and `5105b20`; the original contracts predate them.
Added the API-host process/dependency boundary: SSH/Docker file access does not launch remote LSP.

Documented visible-holder lifetime for warm hidden editors and restoration of their latest buffer.
Qualified the thirty-second read recovery window as retry scheduling rather than an individual
request deadline. Reconnect reopens visible buffers and invokes existing disk conflict handling;
writes are not replayed. Twelve existing tests passed for transient read recovery, cancellation,
non-retryable failures, client eviction/disposal, and synchronization barriers. Live remote-language
integration and product captures remain outside this source-and-fake-transport evidence.

## Troubleshooting storage and history removal

Compared storage reporting, compression codec, vacuum/checkpoint guards, root candidate selection,
manual preview/removal, retention scheduling, and tree deletion. Reviewed storage history `fbdfda5`,
`167226a`, and `9745776`. Removed unmeasured database-share/daily-growth claims; added the
development database distinction, conditional compression, and actual free-space guard.

Qualified reclamation and deletion promises: candidates inspect the root's activity, pin, and
running state only; children do not independently exclude it. A dry-run temporary database probe
selected an old root despite a recent pinned/running child, performed no deletion, and removed the
fixture. Review does not reserve candidates; roots delete independently, and content size is not an
exact reclaimed-disk estimate. Twenty-five existing tests passed for storage, maintenance,
formatting, and tree teardown. No actual workspace history was removed.

Qualified runnable-model inheritance and the workbench definition. Replaced the released-app
permission-once promise with
[Apple's documented folder-access boundary](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web).
Startup logs/launcher behavior and complete effective-configuration troubleshooting remain open.

## Launch logs, startup metrics, and rotation

Compared log CLI parsing/selection, startup milestone matching/percentiles, API destination, desktop
rotation, logger launch fields, and idle scheduling. Relevant history includes `2073d45`. Added
development log location and API destination override, missing launch IDs, source/severity filters,
normalized JSON, and startup report exclusions. Removed unsupported attribution of slow launches to
updates. Qualified maximum idle waiting and best-effort rotation, including startup-only API
threshold checks.

Twenty-six existing tests passed for log merging/statistics, logger identity/redaction, idle
scheduling, and destination rotation. A synthetic temporary CLI fixture confirmed that `--last`
limits rows while percentiles cover all launches, and no-ID entries require the all selector.
Subprocesses had a five-second timeout and SIGKILL; no private runtime logs were read, and the
fixture was removed. Full launcher ownership/port and diagnostics-page comparisons remain open.

## Development preflight and effective-config report scope

Compared launcher process/port preflight, diagnostics input controls, project/session precedence,
host capability wiring, returned values, and workload validation. Added separate PID versus port
error handling and live-but-unresponsive ownership. Clarified typed session IDs, explicit project
override, default-agent capability reporting, and main-participant model projection.

Removed the blanket private-text exclusion: resolved settings can retain custom prompt text and
other user-controlled values even though the response does not expose provider/vault credentials. A
synthetic-port probe confirmed returned custom prompt text and combined explicit-project/session
scope without reading real settings. Fifty existing tests passed for launcher preflights, report
provenance, and cross-field validation. These are structural checks rather than a trace of every
participant/workload execution. Live diagnostics presentation remains separate visual evidence.

## Onboarding project defaults and completion

Compared the Provider wrapper, selection derivation, startup-project helper, Ready summary,
first-run routing, and tab progress against both onboarding guides. Replaced removed browser-local
model keys with server-persisted project settings. Removed the unused recommendation-helper claim
and nonexistent selection-summary description. Documented the awaited Continue save, retry failure,
project-loading prerequisite, reasoning-effort exclusion, structural Ready check, and optimistic
completion synchronization. Existing project and higher-priority agent/session choices remain
relevant when setup is skipped. Owning history currently traces these modules to `ed1ab8d`.

Twelve existing tests passed for tab progress, wizard chrome, and Ready summary interactions,
including stale connections and links back to Provider. Source review establishes the project patch
and save-error branch; these tests do not exercise a real provider request or the complete Continue
save flow. Native setup captures and external OAuth browser returns remain separate evidence.

## Execution adapter reachability and shell discovery

Rechecked environment construction, session birth/external-session defaults and fork copying,
local/remote adapters, shell resolution, and terminal host ports. SSH/Docker remain unreachable
through supported session creation/update; their non-atomic writes and host-key limitations remain
explicit. Corrected Unix's final `sh` fallback, Windows Bash discovery beside Git, override
precedence/validation, and process-lifetime caching. Distinguished file/foreground adapter routing
from host-side PTYs and language servers. Updated the direct session-birth source reference. The
shell module's history currently traces to `ed1ab8d`.

Twenty-seven existing tests passed for shell discovery, factory selection, and shared ripgrep
arguments. A temporary-file probe confirmed that an existing nonexecutable file is accepted as an
override and an invalid primary override skips the valid legacy path; the fixture was removed.
Windows checks exercise path classification on this host, not a native Windows launch. No SSH
server, Docker container, or persistent product terminal was started.

## Answer examples, bounded rendering, and topic context

Compared answer grammar/prompt gating, form parsing, mounted tabs, math and Mermaid caches, and
checklist persistence. Replaced unsupported Localix installation commands with OS-inspection
examples and replaced the unrelated medical timeline. Removed unrepeatable renderer timings and an
unproven find-in-page promise. Clarified per-renderer caches, eviction, optimistic checkmarks, and
the diagram viewer; shortened decorative implementation prose. Relevant history includes `d01cfe5`
and `bf3cac0`.

Fifty-six existing tests passed for answer-prompt scope, callouts/figures/containers, cached math,
and Mermaid scheduling. Layout tests use a Mermaid stub rather than a real browser SVG engine; these
establish contracts, not a benchmark or native diagram capture.

Compared boundary cutting, late-pin insertion, checkpoint pin preservation, and topic admission.
Corrected the claim that only `/clear` cuts context: topic changes also exclude old pins, runtime
facts, and checkpoints. Documented the 4,000-character late-pin text insert separately from full pin
preservation at the next checkpoint and its budget cost. Twenty-two existing tests passed, including
fresh solo/group topic requests after database reopen and admission before hooks. No private session
database or production transcript was used.

## Stored-history search and readable exports

Compared sidebar query debounce/deduplication, owner-scoped FTS queries, agent
discovery/scroll/browse, output degradation, the export fetch path, and Markdown serialization.
Added a public recovery guide within conversation activity, covering bounded ranked hits, terms
rather than semantic/substring matching, loaded-sidebar scope, clipping, and absent-index failure.
Distinguished stored sequence windows from the active branch and model topic view. Clarified export
omissions, generic author headings, timestamps, and redacted placeholders without claiming
prose-secret removal or backup completeness. Owning query/export history currently traces to
`ed1ab8d`.

Twenty-nine existing tests passed for history modes, owner isolation, context-binding index
exclusion, valid bounded JSON, and ordinary/redacted exports. An isolated in-memory database probe
confirmed that an archived session's inactive branch remains searchable and sequence windows cross
branch/topic boundaries, while another user's query cannot retrieve it. The database was destroyed;
no private conversations were read. Live sidebar interaction and native save-dialog evidence remain
separate from these contract checks.

## Git deadlines, discard, and mutation scope

Compared Source Control's command process layer, remote operations, repository-root wrapper, write
queue, commit-all UI, and discard/nuke commands. Corrected obsolete unlimited-network claims in both
public and subsystem guides: network commands have a ten-minute backstop plus HTTP low-speed abort
settings. Removed an unsupported equal-speed diff promise and distinguished visible-row rendering
from read/parse cost. Clarified whole-repository scope from a subfolder, index-preserving Discard,
unborn Nuke, force-with-lease, and retained staging after a failed commit. Owning process/action
history currently traces to `ed1ab8d`.

Fifty-one existing tests passed for command budgets, action arguments/errors, and operations from
subfolder working directories. The network test's old descriptive name says unbounded, but its short
wait proves only absence of the local timer; the timeout-selection assertions and current constants
establish the longer ceiling. A temporary unborn repository additionally confirmed staged A survives
Discard after editing B, Nuke clears the index, and optional cleanup preserves ignored files. The
fixture was removed. No production repository reset, remote push, or history rewrite was performed;
native Git controls remain separate UI evidence.

## Notification catch-up and operation receipt lifetime

Compared logical run reporting, owner-scoped journal sync, outbox buffering, retry/backoff,
interruption selection, and retention. Qualified Retry by typed recovery and provider-owned error
conditions; successful completion reporting waits for the logical run and queued-turn boundary.
Added current-state catch-up rather than transition replay, silent catch-up rows, 2–60-second client
retry, malformed-batch dropping, and seven-day operation receipts independently of journal
retention. Owning journal/run-producer history currently traces to `ed1ab8d`.

Forty-seven existing tests passed for run producers, journal transitions, reconnect/cursor behavior,
client outbox, and interruption policy. A database-in-memory probe confirmed that the same operation
ID is rejected while its receipt exists and accepted after retention deletes that receipt. The
database was destroyed. These checks do not prove native OS banner presentation or unlimited
exactly-once delivery. Existing server/client caps remain documented with pending-row priority.

## Remaining Lightweight Charts recipes

Compared the installed 5.2.0 declarations/build with the recipe reference, and checked official v5.2
series and tick-formatter documentation. Fixed business-day labels, date-level versus clock axis
ticks, pane-aware price coordinate conversion, required exact-price marker fields, and branded
TypeScript timestamps in the entry/color/marker examples. Pinned the standalone CDN example to 5.2.0
and corrected the ESM-only package description. Qualified logical-index synchronization by shared
ordered time points and added exception-safe guards and teardown guidance.

Seven extracted entry/recipe snippets compiled against the installed package with strict checking.
The initial probe failed on callback typing and unbranded marker timestamps; those examples were
corrected before the passing run. Runtime label probes covered business-day objects, date strings,
and New York's spring DST boundary. Temporary snippet files were removed; the compiler had a
ten-second timeout and SIGKILL. These checks do not establish browser canvas rendering or every
wrapper's lifecycle. Earlier reviewed Next.js, historical-update, watermark, and primitive names
remain part of the same recipe reference rather than a new product capability.

## Sandboxed HTML view bridge and native action boundaries

Compared the injected client, opaque-origin document/CSP, live iframe sender check, action table,
per-view scratch storage, API authorization/JSON caps, and backend action dispatcher. Split the
399-line plugin guide's HTML details into a navigable child guide with a concrete registration
example. Corrected the blanket network claim: connect requests are blocked, but approved CDN
scripts/styles and HTTPS images remain allowed. Added pending/wait/payload/state limits,
plugin/view-only browser state scope, fail-soft storage, and timeout without cancellation.

Fifty-eight existing tests passed for srcDoc policy, acquisition/correlation, sender isolation,
capability guards, and backend scope reconciliation. A pure dispatcher probe confirmed a timed-out
handler still completed an isolated mutation. The new registration snippet compiled against the
current SDK with a ten-second timeout and SIGKILL; temporary files were removed. These checks do not
prove native iframe resource loading or cancellation, and no product browser was started.

## Agent-created plugin checks versus product completion

Compared the create command, plugin-build adapter, free-name selection, scaffold activation cleanup,
parallel check plan, candidate publication, and generated author instructions. Qualified the initial
template-residue exception, copy retention when activation rollback cannot be confirmed, and
source/test side effects outside artifact publication. Added description-as-new-copy semantics,
returned-name reuse, command preconditions, absent-test-file behavior, and optional browser
inspection. Removed the blanket claim that a generated plugin never implements OCR/model services.
Owning command/check history currently traces to `ed1ab8d`.

Twenty-three existing tests passed for name normalization, create/build reports, instructions, route
checks, and binding checks. A pure adapter probe confirmed a passing build without browser access
and the conditional visual-inspection hint. It created no plugin. Activation rollback and sequential
publication were compared with source; these tests do not simulate their filesystem failures or
establish a full installed-app authoring run. UI completion remains an explicit separate check.

## Composer uploads, original paths, and model-facing previews

Compared composer gate/staging, large-paste conversion, raw media upload, attachment persistence,
path materialization, spill manifests, and PNG/JPEG downscaling. Added a discoverable public guide
linked from first-session/workspace and the documentation index/navigation. Distinguished accepted
formats from native model parts, document extraction from visual understanding, copied uploads from
mutable original paths, outside-workspace path handling, and missing-workspace limitations. Verified
actual preview bounds as 50 lines and a 128-KiB disk prefix, separately from legacy inline text's
line-only preview, plus 128-MiB raw uploads and the 5-MiB path-image check.

Sixty-eight existing tests passed for staging, upload error/size handling, stored-byte rehydration,
spill/path boundaries, and model-copy downscaling. They include unavailable/oversized paths and
outside-workspace text exclusion. Owning staging/spill history currently traces to `ed1ab8d`. No
private attachment or production database was read. Real document extraction, provider vision, and
composer/native capture evidence remain separate from this pipeline review.

## Native capture placement: Git, checklist, and composer context

Inspected the dated Source Control review, Release Checklist, and composer-context PNGs at native 3×
size after reading the capture workflow. Compared plan ownership, current scenario routing, fixture
provenance, visible UI, and nearby guide claims. Moved the composer frame from checkpoints to
workspace automatic context: it shows open-file/terminal links, not a checkpoint or selection.
Corrected its retained-shot purpose/owner while preserving the semantic key and original pixels.
Added visible fixture provenance to the agent-build guide; Git's diff/control caption remains valid.
Twelve generator tests passed after the ownership change, including native-pixel and asset-path
contracts.

The Git frame has an active scenario; checklist and composer frames are retained dated captures, so
their historical assertions are not a newly executed live test. The terminal frame visibly contains
fixture test results. No new product captures, image edits, model calls, servers, or browser
sessions were started. Other current figures and any necessary scenario refreshes remain in the
audit's visual-evidence scope.

## Editor-reference scope follow-up

Added primary references for VS Code, Sublime Text, TextMate and Emacs to the shortcut guide.
TextMate 2's current manual explicitly documents Command+T Open Quickly; its older 1.x manual is not
the reference for this addition. Emacs's current `xref.el` binds Meta-comma to `xref-go-back`; the
indexed GNU manual documents M-x. Direct GNU manual opens failed in the web reader, so this does not
count as a fresh successful fetch of that page.

Sublime's official page describes its JSON keymap format and directs readers to the installed
platform default file; it is not evidence for every preset chord. The guide now labels that scope.
Fetched JetBrains's default XML and confirmed actions, file/symbol lookup, recent files and terminal
bindings. A follow-up fetched its macOS file/symbol, tab and history variants; the remaining
per-editor comparisons still need verification. These are documentation/source checks, without a new
live editor or keyboard-routing test.

Fetched Atom's archived finder/symbol/tree keymaps, Visual Studio's shortcut reference, Eclipse's
workbench/IDE definitions, and Notepad++'s default shortcut table. Confirmed Atom's
file/buffer/symbol and sidebar chords, Visual Studio's palette/outline/sidebar/tab/history keys,
Eclipse's resource lookup/tab keys, and Notepad++'s Page Up/Down and find-in-files keys. Other
Eclipse actions are not proved by those selected matches. Clarified the buffer-to-session,
outline-to-symbol and IDE-panel-to-sidebar adaptations and added Atom's tree-view reference. Commit
`287f44e` removed Atom's split override; removed the obsolete sidebar/split precedence claim.

## Related guides

- [Provider guide](../features/providers.md)
- [Audit scope and remaining work](documentation-audit.md)
- [Earlier content reviews](documentation-audit-reviews.md)

## Source of truth

- [Provider connection service](../../apps/api/src/features/provider-connections/service.ts)
- [Environment detection](../../apps/api/src/features/provider-connections/env-detect.ts)
- [Key selection](../../apps/api/src/features/chat/runtime/provider-keys.ts)
- [Model resolution](../../apps/api/src/features/chat/runtime/model-resolution.ts)
- [Catalog metadata refresh](../../packages/agent-runtime-pi/src/catalog-metadata.ts)
- [Catalog response validation](../../apps/api/src/features/catalog/routes.ts)

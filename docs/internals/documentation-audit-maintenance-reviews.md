# Documentation maintenance reviews

These are scoped comparisons from the ongoing [documentation audit](documentation-audit.md). The
main audit retains remaining work. Staging/signing statements describe each review's point in time;
later checkpoints are recorded in [interface reviews](documentation-audit-interface-reviews.md).

## Kubernetes configuration and apply follow-up

Compared cached kubeconfig, explicit context discovery, UI selection fallback, manifest cleanup, and
dry-run/live apply calls. Documented the per-context 60-second config cache, valid saved selection
fallback, single-object YAML boundary, stripped server fields, field manager, and no forced
ownership override. Cache expiry does not automatically reconnect an existing watch.

Fourteen selection/scope tests passed. A pure cleanup probe confirmed cloned input, retained
namespace, removed server fields, and rejection of arrays or missing identity. Config TTL and apply
sequencing were inspected in source; no credentials, kubeconfig file, CLI, or cluster was accessed.
The workflow review record is at its readability limit, so this follow-up stays here.

## DevOps tab and mutation-outcome follow-up

Compared UI registrations, tab openers, provider routes, and Docker/Kubernetes action handlers.
Documented root-workspace versus global Docker-detail placement, manual controls versus agent mode
gates, independent Compose member outcomes, and refresh errors after a successful mutation. These
boundaries do not imply provider-data isolation or rollback.

Focused Docker identity and error-shaping tests passed; mutation sequencing and partial Compose
results were inspected in source. These checks do not exercise live controls, actual batch
mutations, daemon/cluster connectivity, or native terminals.

## Root README privacy-boundary follow-up

Aligned the introduction with the reviewed privacy, Vault, external CLI, and HTML-view contracts.
Qualified local storage as Localix-owned data, credentials as Localix-managed values, and native
backend/UI execution separately from the sandboxed iframe view. Added the HTML-view guide link. This
is a source/reference consistency edit; no private data or live credential flow was accessed.

## Contribution checks and Rust CI selection

Compared CONTRIBUTING, the internal development guide, the PR template, current CI change
classification, final validation, and staged-file hooks. Added the missing generated-output gate,
corrected always-run Rust wording to the actual PR path filter with conservative fallback, and
separated focused local evidence from required CI status. Clarified staged/unstaged equality without
instructing contributors to stage unrelated edits.

Six CI-workflow tests passed. The relevant workflow history ends at `65871c1`; its GitHub commit
comment endpoint currently returns zero comments. No full build, repository suite, type check,
native job, or GitHub Actions run was started. Pre-commit was inspected rather than rerun outside a
requested commit.

## GitHub report environment and security routing

Compared issue forms, their chooser, CONTRIBUTING, and the documented launch/log separation.
Expanded the existing environment prompt with desktop/browser client, installed/source launch,
conditional Bun version, and browser version; retained its field id and required status. Aligned
both area pickers with browser workspace support and linked the existing private advisory route
directly from the bug form. Removed fixed OS-version examples that could look like requirements.

Both edited forms parsed as YAML, retained unique field ids, and passed focused client/environment
assertions. This validates the stored form data, not GitHub's rendered form or advisory
availability. No issue, message, advisory, or account action was created.

## Updater failure, save ordering, and migration backups

Compared restart warning collection, shared UI update state, native download/install/relaunch,
bounded frontend flushing, and migration backup storage/retention. Removed the promise that install
failure changes nothing and the uniform save-before-install sequence. Documented the known UI work
roster, bounded saving, platform-dependent install order, check-failure ambiguity, database-relative
backup location, migration-history prerequisite, and best-effort retention cleanup. A database
snapshot does not include workspace files or the Vault key.

Ten restart/update UI tests passed with substituted native bridges, covering confirmation, declined
restart, shared install state, and busy reset. Native sequencing and backup behavior were inspected
in source. No release, download, installer, process restart, private database, or native window was
used; these tests do not prove live installer rollback or preservation of every pending write.

## Updater build-mode consistency across guides

Cross-checked installation, desktop README, packaging, runtime lifecycle, the release wrapper, and
Rust build flag. Replaced checkout-origin absolutes with ordinary versus dedicated release builds:
`tauri:release` supplies the overlay and sets `LOCALIX_UPDATER_ENABLED=1`. Updated the internal
install sequence and database-relative backup/retention explanation to match the preceding review;
removed its unchanged-old-install guarantee.

Focused release-config tests passed for base versus release overlays, validation, and environment
overrides. The wrapper/build-flag connection and native install order were inspected in source; no
bundle, signing key, notarization request, installer, or native runtime was started. A test's
checkout-origin title remains broader than its actual base-config assertions; source tests were not
edited for this documentation pass.

## Introductory product overview consistency

Compared the introductory page with reviewed delegation, participants, plugin availability, and
Preview feedback contracts. Shortened its dense opening, corrected session/turn terminology,
qualified delegation by the default-off tool/root-chat requirement, and removed universal source
mapping and connected-only feedback claims. Distinguished default-assistant UI plugin policy from
the answering agent's own plugin policy and structural tool gates.

A direct preset probe confirmed every shipped agent's whole-tool agents denial. UI versus run
availability and connected-or-injectable Preview readiness were verified in current source. This
slice did not rerun unrelated tests, execute a delegation, or capture a live Preview. It refines
entry-page claims without asserting that all enabled workbenches expose callable agent tools.

## Hero capture provenance and refreshed layout evidence

Inspected the stored 7 October hero at its native 4800×3000 resolution. It shows release.ts, two
passing Bun fixture tests, and a seeded three-agent transcript, without private workspace data. The
two fixture tests still pass. Updated README and introductory-page copy to distinguish seeded
conversation from model-run evidence and to identify the capture date.

Current editor capture composition rejects horizontal pane stacking, while the old hero shows the
editor above the terminal. Restored the stable `workspace/hero` key to the executable capture plan.
Its isolated Playwright scenario passed using installed Chrome; reviewed the native 4800×3000 image
and published the 9 October replacement. It shows real terminal results and an open source-file tab
beside the seeded conversation. No image retouching, provider credentials or model calls were used.

The first seed attempt timed out on signing its disposable Git fixture's initial commit. A repeat
completed because the directory had been initialized; it does not prove a valid Git-history fixture.
The hero scenario does not use that repository. The first capture attempt also found no runnable
hero key, and bundled Chromium was unavailable; both were resolved before the passing run. The
isolated capture runtime and browser were stopped after publication.

Affected document checks and landing generation passed. The intermediate commit passed its hooks but
failed at native 1Password signing (`failed to fill whole buffer`); changes remain staged. The
capture workflow now explains the partial Git-fixture failure and the required `HEAD` check.

## Chess, Checkers and Tic-Tac-Toe skill contracts

Compared bundled play instructions with tool schemas, sequential execution, session ownership,
new-game setup and refusal results. Documented explicit agent-first setup before a batched opening
move, mutually exclusive `action`/`actions`, and retained completed steps after a later refusal.
Tic-Tac-Toe keeps user X and agent O even when the agent starts. Removed Checkers' unconditional
cross-chat memory promise; availability, permission and selected scope govern retention.

All 45 tests in the three backend route/tool files passed, including turn handoff, partial batches,
session isolation and illegal-move rejection. This does not establish model playing strength, live
wake delivery or every game-rule edge case. The relevant tool history points to `ed1ab8d`; its
GitHub commit-comment endpoint currently returns zero comments. No model, live game or memory write
ran.

## System Overview sampling and process-list limits

Compared the bundled inspection skill and plugin README with system caching, native process
collection, tool formatting, resource expansion and visible-context publication. Documented the
one-second snapshot cache before retrying the first CPU sample, Unix versus Windows process CPU
semantics, and the 500/100/50 collector/tool/context row limits. An omitted process is not proof of
absence; process percentages do not share a guaranteed interval with the system gauge.

Ten existing system/process tests passed, including cached snapshots, Windows counter deltas,
bounded collector output, visible timestamp sharing and optional-process failure during resource
expansion. These checks use synthetic process readings; no private machine inventory or process
management was performed. Relevant history points to `ed1ab8d`, whose commit-comment endpoint
returns zero comments. The edited Markdown passed affected documentation validation.

The intermediate four-file commit passed pre-commit formatting but failed at native 1Password
signing (`failed to fill whole buffer`). The documentation remains staged; signing settings were not
changed.

## Structural verification after bundled-skill follow-ups

Refreshed the current inventory and reran anchor, quoted-source and readability validators over all
194 existing owned Markdown files, including staged and untracked additions and excluding imported
skills and vendor trees. All passed. Landing generation still selects 77 public pages and 37 current
captures from 47 dated assets. This does not prove the remaining semantic claims, external links or
figure freshness; those stay in the main audit's remaining work.

## REST skill import and response boundaries

Compared the bundled REST procedure with import preview/write ordering, Vault auth conversion,
deduplicated names, environment activation and response formatting. Removed unconditional vaulting
on import: preview writes nothing, save depends on the host writer, individual requests can fail,
and created secrets are not rolled back. Documented selected response headers, capped/redacted
bodies, JSONPath failure/no-match interpretation and the missing truncation notice in filtered
output.

All 47 existing import-action, import-order, response-formatting and response-filter tests passed.
These use synthetic requests and stores; no remote endpoint, real credential or Vault write was
used. Relevant local history points to `9e6bbe6`; GitHub's commit-comment endpoint returned HTTP 422
because that commit was unavailable remotely, so its remote feedback was not verified.

## Code Graph skill traversal and coverage limits

Compared the exploration skill and public guide with discovery filters, ignore configuration,
omission accounting and graph traversal. Documented impact's default three hops and 1–5 input range,
the directed eight-hop path search and optional reversed edges. These are potential dependencies,
not runtime failure predictions. Clarified that discovery overflow does not count every ignored,
oversized or minified source, and that ancestor ignore files and Git config includes are not read.

Seventeen indexing, graph-view and tool tests passed, including ignore configuration, directed and
undirected paths, transitive impact, scoped targets and retention of a last good graph after a read
failure. The numeric ceilings were checked in source; these tests do not exhaust the 20,000-file or
eight-hop boundaries. Relevant source history points to the initial `ed1ab8d` commit, whose comments
were checked in preceding follow-ups. No live repository scan, model or product capture was run.

## Resume skill initialization, history and export follow-up

Compared the resume procedure with strict tool inputs, template defaults, operation-batch
validation, revision snapshots and export routing. Documented direct initialization from a complete
document, the default template and 1–50 edit operations. Removed unlimited-history wording: on-disk
snapshots retain 60 entries, while ordinary file edits do not preserve every intermediate version.
Tool export returns content without writing a file; workbench downloads use separate export paths.

Eight service, tool and formatter tests passed, covering stale revisions, competing writers,
restoration, custom initialization and visible/native export content. Retention and numeric limits
were checked in source; these tests do not exercise the full retention ceiling, every import format
or live PDF/Word downloads. Relevant history includes `6150d76`; its GitHub commit-comment endpoint
returns zero comments. All test resumes were synthetic; no personal document was read or changed.

Affected document checks and public generation passed. The intermediate commit passed pre-commit
formatting, then failed with the same native 1Password signing error. Changes remain staged.

## Project Space batch, placement and camera follow-up

Compared the board skill and guide with operation limits, single-write persistence, placement
fallback, sequence parsing, roster summarization and camera confirmation. Documented 1–200
operations with independent refusals but one accepted-state write, a crowded frame's overlapping
fallback, native sequence grammar versus complete Mermaid, and bounded camera confirmation and
rosters. Replaced unconditional protection against concurrent external file edits with the actual
per-project store queue boundary. Direct file tools do not participate in that queue.

Twenty existing tool, camera and operation tests passed, including independent refusal results,
permission-path mismatch, matching camera reports, unconfirmed requests and undo conflict handling.
Numeric limits, placement fallback and parser omissions were inspected in source; no live board,
browser, model or external file race was exercised. Relevant history points to `ed1ab8d`, whose
commit comments were checked in preceding follow-ups.

## Learning practice-review contract follow-up

Compared the course skill and bundle reference with focused reads, practice submission identity,
review persistence, turn termination and learner continuation. Documented the mapping from
`assessments[step_id].submissionId` to review's `submission_id`, required feedback, stale-attempt
refusal and preservation of an already reviewed result. A passing review permits continuation but
does not mark the step complete. Feedback belongs in the course after the review tool ends its turn.

Three focused existing service tests passed, covering practice submission/review, missed-wake
recovery and assessed-content invalidation. Duplicate-review preservation and turn termination were
inspected in source; these tests do not establish every review UI transition or live tutor delivery.
Relevant history points to `ed1ab8d`, whose commit comments were checked in preceding follow-ups. No
course, progress or assessment in a real learner session was changed.

## Parsed link graph and retained entry points

Parsed all 194 owned Markdown files with the installed remark parser, including inline links,
resolved reference-style links and HTML `href`/`src`. The current scan found 2,646 link occurrences,
including three reference-style uses and nine HTML attributes; all 1,773 relative targets exist.
This checks filesystem destinations, not external availability, target anchors or intended links
that Markdown renders as plain text because their definitions are missing.

Retained the four non-entry files without incoming links: GitHub consumes the PR template by
convention, and the plugin loader discovers Learning's three command files. The two CLAUDE wrappers
delegate to their AGENTS files and are conventional entry points. Kit NOTICE contains attribution
for current brand-mark source; linked it from the package README instead of treating it as dead. No
deletion was justified by this pass. Aligned kit README/AGENTS checks with the root workflow and
removed duplicated full-gate commands. These are documentation changes; no runtime suite was run.

Affected document validation and public generation passed. The intermediate four-file commit passed
pre-commit formatting, then failed at native 1Password signing; changes remain staged.

## Attachment failure notes and native-path staging

Compared per-file staging, composer rejection notices and error-note creation. Documented that
read/upload failure stages explanatory text without the original bytes, successful files in the same
batch remain available, and policy rejection can omit the note. Added the native-path boundary: it
skips the browser upload-size check while later API-host access has its own limits.

Compared tray removal and clearing with the owning hook: these remove composer entries and revoke
preview URLs, but do not delete uploaded media or original files. Added that storage distinction to
the guide rather than treating transient staging as immediate byte deletion.

Four focused staging tests passed with synthetic files and substituted readers/network calls,
covering upload failure, native-path handoff and policy refusal. Independent batch processing was
inspected in source; this is not mixed-file UI, real-upload or provider-consumption evidence.
Relevant history points to `ed1ab8d`, whose comments were checked in preceding follow-ups.

Reviewed Cline's [Adding Context](https://docs.cline.bot/core-workflows/working-with-files) as a
presentation reference: actions first, then formats and model requirements. Kept Localix's own
byte/path and extraction boundaries explicit rather than borrowing another product's claims about
complete file or folder content. The Markdown endpoint failed in the browser tool; the canonical
HTML page was fetched successfully before this comparison. No private file or live service ran.

## First-session project transition and participant controls

Compared the first-session flow and onboarding limits with startup-project selection, project
settings writes, new-session creation and route resolution. Added a model check after opening a
different project: setup saves the default project's pair rather than copying it into each folder.
Session/agent choices can outrank that project fallback. Removed source-only launch wording and the
obsolete singular Agent selector; the current composer adds participants and keeps per-agent model
routes. Linked the owning conversation guide.

Six focused route-resolution tests passed, covering project fallback, higher-priority choices and
connection/model pairing. Startup-project selection and UI control labels were inspected in source;
no live onboarding, credentials, project creation or model request ran. Relevant source history
points to `ed1ab8d`, whose comments were checked in preceding follow-ups. This is not new evidence
for the stored first-session figure's current composition.

## First-session participant capture refresh

Inspected the stored 7 October participant figure at native size, then restored its stable
`conversations/participants` key to the executable plan. Added checks for three named participant
controls, populated fixture content, menu opening/closing and absence of the leftover tooltip. The
first passing composition exposed an abandoned duplicate synthetic session from the prior partial
seed. Removed only that known duplicate after verifying the isolated database, adjusted focus, and
reran the scoped scenario successfully.

Reviewed the replacement at native 4800×3000 and published the 9 October image. Updated README and
both existing owning figures; captions identify the seeded transcript rather than implying a model
run or successful onboarding. No provider credentials, model call, private workspace or image
retouching was used. The capture runtime and browser were stopped after publication. This resolves
that figure's layout freshness, not the separate live-onboarding evidence gap.

Affected document checks and generation passed: 77 pages, 37 current captures from 48 dated assets.
The intermediate eight-file commit passed its formatting/lint hooks, then failed at native 1Password
signing. Changes remain staged; signing settings were not changed.

## Live job control and confirmation boundaries

Compared `jobs` ownership resolution, action availability, stop/input responses and effect
classification. Added practical list/stop/raw-input examples and distinguished requesting a stop
from observing exit, and attempted stdin delivery from program consumption. Documented the
conversation-owned irreversible `session` stop versus `external` stdin write. Listed work does not
necessarily implement every control, and sub-agents use their own management tool.

All 21 existing jobs-tool tests passed with synthetic running-work handles, covering ownership,
missing controls, request-only responses, effect classes and PTY output advice. Exit-notice arming
failure and deduplicated wake identity were compared in source; qualified the overview table to
match the guide's existing fallback description. Relevant history includes `7d32cee`; its GitHub
commit-comment endpoint returns zero comments. No process was started, stopped or sent input.

The three JSON examples parsed and passed the registered jobs input schema. Affected document
validation and public generation passed; no live job action was executed for those examples.

## Monitor predicate and failed-check follow-up

Compared the polled wait guide with exit-zero evaluation, per-check timeout and failure counting.
Removed the long-running `gh run watch` suggestion from the bounded-check examples. Documented
ordinary nonzero results as pending conditions, terminal task state versus successful task outcome,
and immediate first-poll versus five-consecutive later unrunnable-check failures. Added a bounded
readiness-marker example without starting a process or manufacturing task readiness.

Three focused existing poll-step tests passed for immediate satisfaction and first/later execution
failure handling. Ordinary nonzero interpretation and counter reset were checked in source. This
does not exercise live cadence, a remote pipeline, credentials or actual timeout enforcement.
Relevant history points to `ed1ab8d`, whose comments were checked in preceding follow-ups.

## Rendered heading anchors and generator alignment

Parsed the 194 owned Markdown files and checked 31 local Markdown fragment-link occurrences against
the shared renderer's heading IDs; all resolved. This pass excludes external URLs, root-absolute
links, HTML target IDs and GitHub-specific anchor conventions. No reference-style fragment links
were found. File existence alone was not treated as evidence that a section anchor works.

The generator's heading scan did not match rendering for duplicate headings, setext headings and
tilde-fenced examples. Replaced that scan with the existing shared Markdown heading extractor. Both
focused anchor tests passed, including a new regression accepting duplicate/setext IDs and rejecting
a heading inside a tilde fence. The generator's anchor validation also passed across all 194 owned
files; its link scanner remains limited to inline Markdown links. Affected document validation and
public generation passed: 77 pages and 37 current captures from 48 dated assets.

All 13 generator tests subsequently passed, including lazy page output and concurrent generation.
The scoped three-file intermediate commit passed formatting/lint hooks, then failed at native
1Password signing. Changes remain staged; signing settings were not changed.

## Notification handoff and terminal integration follow-up

Compared problem handoff, composer delivery, notification preferences, interruption composition and
terminal adapters. Corrected **Send to agent** from automatic sending to staging a report in the
source conversation's draft, or the open conversation for application-wide entries. Added the
review/send sequence and the missing-composer boundary: this action neither opens the source nor
buffers an attachment for a later opening.

The UI stores a terminal method but its interruption path only selects native banners. Qualified the
public guide, subsystem guide and package README so adapter support does not imply a connected
OSC/BEL delivery path. Also aligned native `hitl` classification with the `human-input` category.

Six focused existing tests passed: report-body preservation, live session-addressed delivery,
dropping unbuffered inserts without a composer, and terminal capability/encoding/expired-event
policy. Session selection and absence of automatic submit were checked in source; no live agent,
native banner or terminal notification was triggered. History includes `ed1ab8d` and `1f055fb`; the
latter's GitHub comment endpoint returned HTTP 422, so remote feedback remains unverified.

Affected document checks and public generation passed: 77 pages, 37 current captures from 48 dated
assets. Changes are staged alongside the preceding audit work.

## Individual shortcut editing follow-up

Added the current search/record/confirm/try workflow, unassignment and the distinction between
per-command catalog reset and reapplying a complete preset. Compared the recorder, row controls,
settings search and editor hook. Two existing DOM tests passed with 83 assertions for Escape,
conflict confirmation, every preset, custom edits and reset-all synchronization. Per-row reset,
search and immediate local update were checked in source; no OS key delivery or server save was
exercised. History includes `823a1af` and `7d384c8`; both GitHub endpoints returned zero comments.

Affected document checks and generation passed. The five-file intermediate commit passed its hook,
then failed at native 1Password signing; changes remain staged without changing signing settings.

## Related guides

- [Workflow reviews](documentation-audit-workflow-reviews.md)
- [Content reviews](documentation-audit-reviews.md)
- [Runtime reviews](documentation-audit-runtime-reviews.md)

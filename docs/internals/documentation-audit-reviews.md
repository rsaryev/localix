# Documentation content reviews

Detailed source comparisons from the ongoing [documentation audit](documentation-audit.md). These
records describe completed review slices; the audit’s remaining-work list defines what is still
unresolved.

## Permission modes and human requests

Compared ordered rule evaluation and skill preapprovals, mode rewriting, host-root exemption,
plan-file classification, snapshot authority, permanent-rule insertion, requester-scoped grants, Ask
deferral/expiry, the shared five-minute deadline, and attention ranking with current source. Recent
owner history includes `7d384c8`; current functions determine the documented behavior.

- Corrected Bypass and Autonomous: call-class questions are removed, while named tool/command
  questions become allows in place. Artifact admission rules are not rewritten.
- Corrected Plan's file exception: Markdown files directly in the conversation's own plan directory
  qualify; `PLAN.md` is the working draft, not the only accepted filename. Database versions remain
  authoritative over snapshot files.
- Qualified host-root protection by its existing project exemption, grant reuse by the requester,
  and dangerous-call prompts by the policy decision requiring confirmation. Included `edit` beside
  `write` and `apply_patch` in the existing allowed-state-write behavior.
- Replaced the obsolete newest-notification inbox description with server-owned ranked attention and
  per-window snoozing. Added source owners for the policy, deadline, and grant contracts.

This review establishes these mechanisms. The detailed plan-tab UI lifecycle and the external CLI
HITL adapter section still need their own source comparison before those guides are fully reviewed.

## Session storage, deletion, and activity history

Compared working-directory resolution, scratch cleanup, project soft deletion, full-tree deletion,
fork construction, composer draft persistence, Markdown export, transcript projection, adjacent
notice coalescing, linked continuation ownership, and model wire projection with current source.
Owner history includes `18cd8e0`, `6150d76`, and `9745776`.

- Removed the stale common-Default-directory and global-capability-scope explanation. Root scratch
  chats have separate directories; children/forks share their root's directory and project settings.
- Corrected deletion to include all descendants, with teardown before row removal and filesystem
  cleanup afterward. Documented preservation on tree/teardown failure, the child scratch exception,
  project-directory preservation, and best-effort residual-file cleanup.
- Replaced the obsolete memory-only draft claim with the browser-storage contract: 400 ms debounce,
  50 stored drafts, and a 32,000-character per-draft persistence ceiling. Attachments remain
  transient.
- Described copied fork identities and inherited versus explicit model choices. Qualified repeated
  item recovery to explicitly linked continuation segments with the same author.
- The inspected queue priority bands agree with the conversation guide. Its participant addressing,
  full control protocol, retry selection, and topic-boundary claims still need a separate full
  review; the session-list UI/search details also remain to be checked.

## Scheduled loops and monitor credentials

Compared loop target gates, cancellation/manual fires, cron and delay restart policies, watchdogs,
and backoff with their owning services. Qualified parent-session busy/quota gating by target,
documented non-overlapping manual fires, and clarified overdue-slot catch-up and volatile backoff.

Compared monitor limits, bash interval clamping, poll verdicts, command spawning, and the credential
cache. Removed the claim that environment injection makes the curl header invisible to process
inspection: shell expansion can place it in argv. Documented cached Vault resolution and rotation,
and replaced the obsolete multi-policy permission wording with the actual per-run rule gate.
Background-job lifecycle and the remaining monitor/plugin streaming claims still need review.

## Privacy storage map and Vault bounds

Compared Vault database/version ownership, master-key loading, authenticated payload context, legacy
cipher handling, per-user exposure-shield variants, MCP OAuth storage, updater cadence/error
posture, wire-dump placement, and the shell WebCrypto fallback with source. Owner history includes
`a00fef1` and the initial implementation.

Corrected the privacy table: encrypted Vault versions and readable metadata live in SQLite; the
separate Vault directory owns the master key. Documented the paired backup boundary and key refusal
instead of replacement. Qualified the WebCrypto keychain claim by initialization success/fallback.
Clarified the shield's trimmed-length floor, 256-variant per-user cache, and eviction behavior. The
broader outbound and native-plugin privacy claims still need their full source review.

## MCP runtime inventory and imports

Compared exact registry lookup and the grep seed, transport/environment expansion, optional connect
budget, tool visibility filtering, import-to-rule translation, output ceilings, persisted inventory
bounds, discovery retry, and deferred tool assembly with current source. Recent owner history
includes `9745776` and `22af090`.

Corrected the direct-schema-per-request claim and replaced legacy runtime allow/deny fields with the
actual capability-rule mechanism. Documented import translation and the seeded record's
empty-project boundary: ordinary chats, including Default, do not inherit it. Qualified retryability
for stale lazy descriptors and added resource-list caps. OAuth UI/round-trip and declarative-hook
behavior remain pending their detailed content audit.

## Plugin synchronization and host lifetime

Compared the shared resource scheduler, project-file adapter, store publisher/snapshot reader,
explicit mutation observer, and shared-module page lifetime with their implementations. Owner
history includes `3a0d3c3`.

Qualified `refresh()` as waiter completion rather than proof of a successful snapshot, documented
bounded retries, and replaced authenticated-scope wording with host-supplied identity plus ownership
checks. Corrected the UI-kit-only host-access claim and distinguished `pagehide` from hidden panes.
Moved keyboard ownership into related guides so source references remain the final section. The full
manifest, authoring/build pipeline, and HTML bridge sections still need their content audit.

## Bundled Battleship and chart skills

Compared Battleship's actions, batch limit, hidden fleet, random setup, and session-owned storage
with its tool/service. Split the oversized introductory prose and removed guaranteed memory
retention and unsupported placement inference.

Split the 631-line chart skill into a main workflow and a linked recipe reference. Compared the
installed 5.2.0 declarations with chart/pane APIs, historical update, primitive names, and minimum
scale width; checked official v5.2 marker source and Next.js lazy-loading documentation. Corrected
nearest-bar marker placement, the width constraint, historical update, and the App Router client
wrapper. Remaining chart recipes and the other bundled skills still need their content review.

## Remaining game, System Overview, and REST skills

Compared Chess/Checkers/Tic-Tac-Toe action batches and new-game defaults, 2048 plan validation,
System Overview/process collection and durable marks, and REST export routing/credential guards with
source. Qualified memory availability/retention, distinguished board color swapping from tool
new-game defaults, and documented 2048 batch limits and goal checks.

Clarified that System Overview marks mutate durable plugin state (50 retained, 200-character notes).
Changed the REST sharing example to a deliberate export folder outside Localix's private `.localix`
state, qualified HTTP error interpretation, and removed the claim that every literal credential is
detected or every reference-bearing export is safe to publish. Other bundled skills and the chart
recipe details remain in scope for the audit.

## Project Space, Code Graph, Learning, and Resume skills

Compared Project Space's camera schema and sequence dialect, Code Graph's map/lens/view commands,
Learning outline creation and tutor-generation outcomes, and Resume's tool union, templates, field
guards, and export projections with source.

Corrected Project Space's browser picture action to `take_screenshot`, qualified Code Graph coverage
wording by response type and camera confirmation, and documented Learning's unavailable-tutor
outcome with a direct link to its bundle reference. Specified Resume restore's current/target
revisions and the section constraints on context/proficiency fields. Remaining deep chart recipes
and Learning bundle examples still need review; the other bundled skill entry points now have source
comparisons recorded.

## Docker, Kubernetes, and DevOps guides

Compared lazy Docker selection/version negotiation, shell prerequisites, Kubernetes manifest apply,
node drain, generic listing, tab-owned forward cleanup, and bash grant scopes with source. Reviewed
the implementation history for Docker selection and manifest apply (the initial commit).

Corrected startup-time selection to first use with a demand-driven 30-second CLI reprobe, removed
unsupported per-request schema-cost estimates, and qualified CLI availability for agents. Replaced
the single-call approval claim with the actual remembered program scope. Documented partial drain
changes and best-effort forward cleanup, and narrowed the truncation claim to generic object lists.

## Background work and monitor lifecycle

Compared job admission, owner-filtered jobs access, PTY/child capture, initial-output settling,
completion reminders, exit notices, monitor logs/batching, and restart recovery with source.
Reviewed the jobs wiring history, including the terminal-control correction.

Corrected the admission count to include monitors and other work while excluding sub-agents; monitor
creation still has its separate cap. Qualified readable output by terminal availability, removed
immediate-return and universal-action claims, and documented asynchronous row persistence. Clarified
silent explicit stops, notification fallback, watch event batching, and the 20-entry wake limit with
no ended-monitor log retrieval.

## Plan review, continuation, and version lifecycle

Compared presentation normalization and limits, approval/comment delivery, live tab routing, comment
carry, completion/dismissal, live-mode checks, and Continue availability with source. Relevant plan
service and UI history currently traces to the initial commit.

Qualified presentation as ending its author’s turn, automatic tabs as live cues, and unchanged
versions as whitespace-normalized comparisons. Distinguished activity labels and agent-reported
completion from verified implementation. Documented the approved strip’s close action as dismissal,
background jobs not blocking Continue, snapshot failures, and returned comments after failed wakes.
Corrected unconditional file retention: root Default-chat scratch cleanup can remove its plan files.

## Learning bundle reference

Compared every manifest example with the loader schemas, reference guards, ready-lesson progression,
import selection, and module-warm conditions. Added complete flashcard/walkthrough examples and
qualified option-ID scope, progressive generation, file limits, and optional code explanations.
Validated assembled examples through the actual bundle loader in temporary fixtures, including all
six step types, pending lessons, and rejected invalid progression. Reviewed the three Learning
commands against draft/activation and materialization contracts; qualified their automatic-warm
claims. Relevant loader and generation history traces to the initial commit.

## Global search scope, failures, and pagination

Compared registry fan-out and timeout, HTTP grouping, core file/history providers, UI scopes,
request sequencing, paged appends, result activation, and tab/palette problem ownership with source.
Relevant provider/service history currently traces to the initial commit.

Replaced silent-failure claims with the current partial-result contract, while documenting providers
that swallow errors internally. Qualified timeout/abort boundaries, later-page findings, project
filtering after capped history matching, and omitted-id semantics. Added workspace instructions for
quick search, explicit live domains, and bounded totals.

## Database connections, agent actions, and cancellation

Compared the unified `database_client` registration/classifier, saved configuration store,
credential resolution, SQLite probe effects, query cancellation, script failure, UI reconnection,
and connection sync with source. Reviewed unified-tool/query history and the event-driven
synchronization commit.

Removed stale three-tool and live-driver admission claims, qualified read-classed SQLite tests, and
replaced a hard 30-second stop claim with cancellation semantics. Documented plaintext literal
configuration, scoped the no-credentials claim to connection summaries, and corrected push/fallback
polling. Failed writes and row caps no longer imply that mutations cannot partially apply or be
interrupted. The following review covers the SQL diagnostics and per-driver row-cap claims.

## Database SQL checks and row limits

Compared cached-schema diagnosis, editor marker ownership/timing/size caps, validation skip
behavior, service budgets, and SQLite/PostgreSQL/MySQL/SQL Server/ClickHouse compile and
row-collection paths. Reviewed validation/cap history, including removal of the DuckDB driver.

Corrected unconditional side-effect-free validation and never-wait claims. A direct isolated
`bun:sqlite` probe through `compileSqliteStatement` changed `query_only` from 0 to 1 while returning
`ok: true`; official SQLite PRAGMA documentation confirms preparation-time effects. Documented
position fallback, 200,000-character UI limit, skipped semantic errors, per-unit/request budgets,
and read/transaction conditions on early row termination. This was a source comparison and one
SQLite probe, not a live test of every network database.

## Related guides

- [Audit scope and remaining work](documentation-audit.md)
- [Learning bundle reference](../../plugins/learning/skills/build-learning-course/references/course-bundle.md)

## Source of truth

- [Learning bundle loader](../../plugins/learning/backend/course-bundle.ts)
- [Learning module generation](../../plugins/learning/backend/module-generation.ts)

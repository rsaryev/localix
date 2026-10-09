# Documentation workflow reviews

Source comparisons for the ongoing [documentation audit](documentation-audit.md). These records
cover reviewed behavior and verification limits; they do not establish completion of the full audit.

## Tool budget and conversation routing

The tool-budget follow-up compared report composition, route inputs, snapshot scope, usage storage,
and verdict ordering. Corrected the consolidated `mcp_resources` name and the report's project-level
scope: Tools settings can resolve an agent, but the GC route does not pass `agentId`, and its
accepted `sessionId` does not select an agent. Documented shared user/project counters and evidence
from tools no longer enabled. Removed speculative UI-cache wording and linked the actual
protected-name set. Sixty-one existing tests passed across verdict ordering, report composition,
usage persistence, and catalog/route availability. A direct Hono probe confirmed that the GC query
forwards `sessionId`, drops `agentId`, and reads usage from the explicit project; agent resolution
was checked in source, not through a live session.

Compared conversation mention parsing, recipient selection, pre-trigger history, ticket merging,
queue bands, and reference promotion. Clarified that leadership election happens only before a
participant's first public answer; later unaddressed turns use continuity or least-recent history.
Documented case-insensitive handles, inactive names, roster-order fan-out, and explicit addresses
before the remaining `@all` recipients. Specialist routing is an agent instruction, not subject
classification by the scheduler. Thirty-five existing tests across five files passed, plus four
strategy probes for roster order, mixed broadcast, unknown handles, and history fallback. Inspected
`18cd8e0`'s strategy change: it adds the topic-change self-handoff exception, not a new addressing
rule. These checks do not prove the rest of the conversation-control protocol or live model
behavior.

Compared the control tool schema, membership writer, queue admission, required-call repair, and
terminal check. Clarified validation before membership persistence, exact-case tool references,
active-speaker/empty-roster guards, two repair attempts, and topic field bounds. Documented partial
persistence on a later queue/publication failure and that `next: []` adds no turns without
cancelling existing ones. Thirty-eight existing tests across five files passed. An in-memory
real-control-port probe confirmed that a failed queue admission preserves the changed roster and
leaves completion false, a subsequent retry succeeds, and the reminder producer returns only two
repair turns. The probe used a fixture repository and queue sink; it did not change a product
conversation or test a live provider's compliance.

Compared roster-lock gates, branch cancellation, Stop admission/settlement, child cascades, and
queue clearing. Corrected the claim that editing or Stop clears every pending turn: cancellation
targets unclaimed agent tickets; user rows and machine wakes remain. Documented the five-second
settlement budget and best-effort child cascade. Twenty-seven existing tests across four files
passed. A real in-memory queue probe confirmed ticket-only cancellation and Clear preserving a
leased user row. The first probe incorrectly inspected `content` on public rows; corrected it to the
actual `preview` field before the successful run. No live session or child process was stopped.

## Kanban persistence and action boundaries

Compared the public board guide with the bundled README, store, workflow rules, operations, tool
input guards, and resource/search providers. Added partial-create recovery, take eligibility and
assignment guards, the 50-card tool-result cap, deletion graph effects, and malformed-file fallback.
Qualified card-ID non-reuse by ordinary deletion; replacing a malformed board resets its sequence.
Clarified that cancellation freezes status rather than all edits.

Forty-seven existing tests across four backend files passed, including partial-create results and
dependency/ownership refusals. A real service probe in a temporary directory confirmed
malformed-file replacement, restarted `LX-1` numbering, and edits to a cancelled card; the directory
was removed. No production board or model run was used. The owner history has only the initial
import for these files, so current functions supply the contract evidence.

## Delegation fan-out, wake budgets, and report steering

Compared the current one-level delegation policy, strict task schema, lane queue, follow-up message
buffer, self-wake budget, and tool-checkpoint report admission. Removed the obsolete 3/2/1 fan-out
ladder; root chats may involve three agents and children cannot delegate. Distinguished a child's
assignment from its own system context, clarified UTF-16 title bounds, and documented volatile lane
queues. Self-wake streaks reset on external producers as well as user turns; creation budgets still
reset only on the person's message.

Corrected both conversation and delegation guides: an eligible addressed child report may join a
running parent's next model request after a completed tool turn, once per boundary. Other reports
retain a separate turn. Forty-one tests across five files passed for hierarchy admission, wake
budgets, recipient gating, checkpoint settlement, and steering; no live provider was run. Inspected
`7991c67`'s hierarchy contraction and stream changes; the checkout's complete predicates determine
current behavior. Earlier records that describe all child reports as separate turns are historical
review evidence, superseded by this current-source follow-up.

## Runtime steering and tool activation consistency

Searched first-party guides and READMEs for obsolete report-isolation and depth-ladder wording, then
compared the internal runtime guide with port boundaries, Pi event mapping, host checkpoint gates,
report/question-answer eligibility, deferral assembly, activation storage, and prompt construction.
Added the two-second checkpoint wait and its timeout/abort behavior. Removed unverified schema-cost
and price claims and the promise of an unchanged tool roster/cache prefix. Core tools remain subject
to policy and run shape; activation storage is best-effort; future assembly can drop unavailable or
evicted names while an active Pi run keeps schemas it already revealed.

Fifty-four existing tests across five files passed for tool splitting, activation lifecycle and
storage, mixed known/unknown names, and Pi steering with controlled providers. A direct adapter
probe confirmed that a released remembered name remains in the current run's model roster. No live
provider or product session was used; this does not establish every runtime guide claim.

## External CLI transcript windows and context budgets

Compared external-session model inputs, semantic guards, shared adapter windows, service defaults,
multi-session composition, compact resource digests, and native resume declarations. Added the
head-versus-tail defaults, conflicting `from`/`tail` refusal, default 400 and maximum 2,000 events,
source-relative positions under truncation, deduplication and missing-key behavior, and the
120,000-unit default context budget. The brief resource digest targets 3,000 units and six event
summaries; it is not a complete transcript or a provider token budget.

Fifty-three existing tests across six files passed for read ends, truncated sources, window
positions, context collection, and rendering budgets. Direct tool-boundary probes verified the
conflicting-window guard, accepted forward read, and event cap. GitHub comment queries for the owner
commits [`a5399e7`](https://github.com/rsaryev/localix/commit/a5399e7) and
[`ecb6209`](https://github.com/rsaryev/localix/commit/ecb6209) each returned zero; this is a
selected history recheck, not a new repository-wide review. No real CLI was launched and no private
history was read; native process/link lifecycle and permission prompts still require their own
evidence.

## External CLI linking and terminal launch failures

Compared link/attach/open-owned routes, pending native identity correlation, installed-provider
checks, terminal reuse, and UI opening/preview actions. Replaced the recipe's removed Import to
Localix and separate History → External instructions with the current identity-only linked-chat
flow. All six adapters declare native continuation. Added saved-link versus launch-failure behavior,
provider-switch refusal, missing executable/history errors, and the pending-identity guard that
prevents silently starting another native conversation. A repository documentation search found no
remaining copies of the removed import-flow wording.

Seventeen existing backend route tests and seven UI tests across four files passed, including
concurrent openings, user/scope guards, missing-source refusal, identity correlation, preview-only
behavior, and linked terminal navigation. UI tests use mocked APIs and terminals; no real CLI,
authentication, native permission prompt, or process-stop behavior was exercised. The recipe directs
a person to the CLI's own controls without claiming Localix mediates its internal permissions.

## Interactive terminal waits and interrupted input

Compared terminal action fields, pre-input guards, wait outcomes, event subscriptions, input bursts,
and named-key encoding with the interactive guide and recipe. Added 100–120,000 ms explicit wait
bounds, the 15-second default, marker-missing exits, and cancellation that leaves a PTY running.
Documented partial input before interruption and literal fallback for unknown key names. Added the
recipe's source owners and removed its claim that every action sends input.

Fifty-one existing tests across four files passed for keys, waits, compound actions, cancellation,
and observations. All three JSON recipe examples parsed through the real bash input schema; this did
not execute the Python REPL examples. Direct leaf-function probes confirmed literal unknown keys and
an interrupted wait that sent no input and left the fixture terminal running. No real PTY, shell
command, or product session was started.

## Goal-to-task recipe delegation input

The planning recipe still used the retired flat `agents` delegation fields and omitted required
priority. Replaced that call with a fenced `tasks` example, explicit tool enablement/root-chat
availability, and self-contained acceptance criteria. Distinguished a shared conversation handoff
from isolated child work and the passive board from delegation lanes. Added related guides and
source owners. The real Agents descriptor accepted the new JSON and rejected the old shape without
executing either. Thirty-four existing Agents tests passed. This establishes the input contract, not
completion of the sample QA assignment.

## Visual-feedback recipe and comment attachment

Compared preview availability, viewport presets, picker gestures, screenshot staging, comment
submission, and composer bindings. Removed the recipe's numbered-pin expectation: elements receive
quiet tints and comments are reviewed in attached context. Corrected both guides' extra text-attach
button and mandatory-note claims. Text selection attaches immediately without a note card or
screenshot and is bounded to 500 UTF-16 units; element comments allow empty notes and can attach
without a failed screenshot. Made screenshot inclusion optional and removed a duplicate source link.

Nineteen existing tests across five files passed for selection, preview sizing, comment attachment,
and bridge lifecycle. The bridge DOM tests emitted React act-environment warnings; all assertions
passed. This is controlled DOM evidence, not a new native screenshot or live preview run. No product
UI changed and no capture runtime was started.

## Tool-roster projection and schema-budget failure

Compared the public tools guide with the catalog, ledger, scoped Settings snapshots, dispatch-only
stubs, initial prompt roster, deferral assembly, and Browser opening/readiness. Qualified core tool
availability, separated Settings access from the active run's verdicts, removed the contradictory
claim that every deferred name is in the prompt, and documented activation persistence and Browser
open's ability to create a preview. Linked tool changes follow the sent message's context.

Forty of 41 tests across ledger, withheld stubs, run shapes, and schema budgeting passed. The budget
assertion failed: the composed 23-tool fixture estimates 7,507 tokens against its 7,500 ceiling.
Per-tool and fixture-completeness checks passed. The threshold was not changed and no runtime tool
schema was edited; this remains an unresolved source-side verification result. Seventy-three Browser
tests passed, including opening/readiness failures and lazy opening. This is not an all-green roster
check or live browser evidence.

## Capabilities, mode rewriting, and rule editing

Compared capability resolution, whole-tool denial proofs, mode rewriting, switch translation,
registry mutations, and the rules editor's staged-save flow. Qualified Plan's own-file/session-state
exceptions and named-tool versus call-class confirmation rewrites. Removed the claim that every
switched-off tool schema disappears: later argument exceptions can retain the candidate while the
gate judges individual calls. Documented immediate registry writes versus Apply/Reset drafts and
explicit allow versus restoring defaults. Replaced the rules-to-shape diagram with all structural
and policy gates; removed the duplicate resolver link.

Thirty-nine existing tests across resolver, mode policy, and rule changes passed, including argument
exceptions and preserving denials during confirmation rewrites. Save timing was checked in UI
source, not through a live Settings session. This follow-up does not resolve the independently
recorded 7,507-token core-schema budget failure.

## Permission-rule ordering and worked examples

Compared the live matcher, capability-to-permission projection, shipped presets, and permanent-rule
insertion. Added a three-row Git example with concrete outcomes and explained the editor versus
runtime field names. Removed specificity-as-priority wording and internal implementation prose.
Corrected the claim that confirmation guards are literally last: role call restrictions and the
default `agents` denial follow them, and a matching later restriction still decides.

Seventy-nine of 80 existing engine and permanent-rule tests passed. The positional guard test failed
because the backend outside-workspace row is at index 21 and a wildcard-resource `agents` denial is
at index 23. A separate real-preset evaluation confirmed outside-workspace reads and dangerous Bash
calls still ask. This identifies an overbroad test assertion, not an observed guard bypass; the
source test remains unchanged and failing. No live confirmation card was exercised.

Reviewed [OpenCode's permission guide](https://opencode.ai/docs/permissions/) for its worked-example
presentation. Localix behavior was checked against its own source; OpenCode's configuration format,
agent/global merging, and session-only `always` approval were not transferred into this guide.

## Permission modes and classification fallback

Checked the mode rewrite against Bash, memory, and plan-file classifiers and the shared fallback.
Replaced the unconditional "denial stays a denial" claim with retained denial rows and last-match
semantics: later named questions can already override earlier denials and become allowances in
Bypass. Qualified catastrophic detection as a lexical classifier, rather than a guarantee about
every process. Added Plan examples for foreground reads, terminal input, memory scopes, and own-plan
edits. Corrected both permission guides: absent `classify`, `mutates: false` is a read; a true or
omitted flag is external.

Seventy-nine existing tests across gate classification, Bash, memory, and plan-file classification
passed. No shell command, provider run, or live mode picker was exercised. The earlier
guard-position test and core-schema budget failures remain independently unresolved. The detailed
plan lifecycle review recorded in previous slices was not repeated.

## Practical memory inputs and scope verification

Rechecked the shared scope policy and tool dispatch against the already reviewed memory guide. Added
explicit project-write and list inputs, plus the distinction between write targeting and read
visibility: under All available scopes, `scope` does not narrow get/list/delete, and a session copy
can shadow a project value. Qualified tool-removal wording for later argument exceptions, matching
the separately reviewed capability resolver.

Both new JSON examples parsed against the real tool schema. A real-tool probe with an instrumented
repository verified the project write target, session-first get despite `scope: project`, and the
session/project/global scopes passed to list and delete. The repository was substituted: this is
dispatch evidence, not a new disk-storage, live-agent, or deletion-rollback test. Previously passing
memory storage and classification tests were not repeated for these documentation-only changes.

## Vault reference inputs and mutation outcomes

Compared flat wire versus strict action schemas, masked-input requests, metadata projection, delete
approval/results, production delete wiring, and the shared interpolation helper. Added get/rotate
examples without a value field, the distinction between references and literal interpolation,
metadata visibility, stale-version refresh, binding-aware agent deletion, and the shared five-minute
decision deadline. The earlier storage/cipher/exposure-shield review was not repeated.

Twenty-two existing Vault-tool and secret-interpolation tests passed. Both JSON examples parsed
against wire and action schemas; synthetic-value probes confirmed rejection of a value field,
literal unescaped interpolation, and refusal of a missing reference. Production wiring omits force
for agent deletion. No stored credential, master key, native prompt, or live provider was accessed.
Relevant source history currently points to the initial implementation commit; this slice makes no
claim of newer review feedback.

## Plugin wake admission and surface tool lifetime

Compared SDK requests, host validation/framing, production delivery wiring, queue key joining,
surface-plugin selection, and tool promotion. Corrected delivered-as-answer wording: it is queue
admission, with no completed-action receipt or automatic retry. Qualified the tools list as up to
six distinct owned names for validation/framing, rather than the whole callable roster. Explained
policy/host/model filtering, latest-person-message tab context, and explicit activation's separate
lifetime. Removed the claim that every schema rides on every request and corrected Battleship's
completed-game reveal boundary using the previously reviewed game contract.

Twenty-six existing tests across plugin wake validation, surface tools, plugin queue draining, and
common delivery passed. These establish framing, load replacement/union, queue propagation, surface
selection, and failed-delivery outcomes; they are not live game or provider evidence. The surface
promotion path has no separate budget cap here, so the guide does not claim one.

## Plugin problem ownership and prerequisite recovery

Compared prerequisite data/parsing, recovery helpers, typed errors, executable lookup, standing
problem publication, runtime terminal wiring, and the terminal input channel. Corrected the hook's
return shape, removed historical layout/PATH anecdotes, and documented unconditional ownership, null
settlement, no unmount settlement, shared-subject ownership, and retained first-request traces for
unchanged poll failures. Added missing recovery-data behavior and qualified command insertion: only
trailing line feeds are stripped; interior newlines remain. Recommended single-line recovery
commands and explicit retry/readiness checks rather than promising automatic recovery.

Thirty-one existing tests across prerequisites, executable environment, typed errors, problem
publisher, and terminal bus passed. UI helper/renderer wiring was inspected in source; no browser,
native clipboard, external executable, installation page, or live terminal was opened. Tests of the
publisher prove transitions, not React unmount behavior; the latter is established by the hook's
absence of settlement cleanup. Current helper history points to the initial commit.

## Shared Markdown entry points and rendering boundaries

Compared package exports, portable renderer, heading assignment, lazy math loading, plugin host
entry/catalog, and workspace renderer props. Added the actual plugin import/example separately from
standalone document rendering; documented host-provided CSS and checklist source callbacks.
Qualified heading stability by text/duplicate order and math rendering by asynchronous loading and
retry behavior. The existing dialect examples remain in place.

Seven portable renderer and tab DOM tests passed, covering sanitized HTML/links, heading/outline
agreement, literal dollars, tree markup, and accessible tab associations. Both TSX examples passed
syntax transpilation; the plugin import and children/callback contract were inspected against the
host entry and props, rather than a full plugin build. No live documentation browser or native
capture was started; diagram engine and reading-control behavior remain separate evidence.

## Native plugin keyboard ownership

Compared focus hook lifetime, scope/path routing, modal barriers, default key policies, and exact
chord matching. Replaced the partial snippet with a complete component that attaches its root,
tracks visibility, and claims unmodified Escape only while a local selection exists. Added policy
defaults, restrictive combination, null roots, portal boundaries, and the distinction from sandboxed
iframe views. Linked the actual SDK and chord source owners.

Twenty existing focus-store, scoped-routing DOM, and workspace keyboard-routing DOM tests passed,
including nested claims, modal isolation, composition/AltGraph, and already handled events. The
component example transpiled and its Escape matching was checked directly, including modified-key
rejection. The hook's current-value refs and inactive/unmount cleanup were inspected in source; no
native plugin, browser capture, or iframe interaction was started.

Inspected the focus-file scope of `823a1af`; GitHub's commit-comment endpoint currently returns zero
comments for that commit. This is a scoped feedback check, not a renewed repository-wide audit.

## Plugin work-item scope and instance identity

Compared SDK request forwarding/session context, root-workspace resolution, scoped instance ids, and
the production instance namespace guard. Corrected per-chat singleton wording: child sessions share
their root's display workspace, while distinct instance ids can create multiple tabs. Documented the
required plugin-owner prefix and opaque scope boundary. Shortened the shared-import history
paragraph to its current contract. This slice does not establish every claim in the large workbench
UI guide or merge display scope with server-side data ownership.

Twenty scope and SDK-runtime tests passed, covering scoped identity and explicitly forwarded session
destinations. Namespace rejection and root mapping were checked in source; no plugin UI was mounted
or live child-session interaction captured.

## Cross-guide workspace and Browser scope consistency

Compared the workspace guide with grid scope stamping, tab session-context wrapping, Browser strip
storage, and origin-session metadata. Corrected its per-session Browser claim and table wording:
root/child sessions share a root workspace strip; separate roots retain separate strips. Clarified
the plugin hook's tab context as derived from display scope, rather than an inferred child opener.
This display contract does not prove server-side browser-tool admission or shared data ownership.

Five existing preview-store tests passed for separate chats, deletion, closing, viewport reset, and
reordering. A direct real-store probe supplied a child-to-root resolver and verified root placement,
preserved child origin, and a separate second root, using synthetic URLs without navigation. No live
Browser, native window, or private workspace state was accessed.

## Plugin SDK README and authoring entry points

Compared the README with private package metadata, exported entry points, runtime ports, tab
context, and the existing host-supplied authoring kit contract. Removed the obsolete source-only
authoring claim and speculative publication boundary; linked both user-plugin creation and
registration guides. Added runtime/context entries and clarified optional ports without granting
access to host internals.

All ten SDK import specifiers named by this README exist in package exports; the package has no root
export and the newly linked source files exist. Documentation reference/readability checks passed.
This is an export/authoring documentation check, not an independent SDK publication,
generated-declaration compilation, full plugin build, or runtime-port availability test.

## OS handoff result and timeout semantics

Followed up the existing utility README audit with the execution seam. Corrected success wording for
Windows rundll32: any numeric exit is accepted, unlike zero-required macOS/Linux openers. Documented
spawn-only direct applications, the default 15-second opener deadline without child termination, and
target-bearing caller-controlled logging.

A substituted-spawn probe confirmed Windows exit 7 returns success without performing a real OS
handoff. Existing execution tests were run for failure, timeout, and spawn reporting; no URL,
application, file manager, or native handler was opened. This does not establish visible target
delivery on any platform.

## Refreshed owned-Markdown consistency pass

Enumerated current tracked/untracked existing Markdown, excluding imported `.agents/skills` and
vendor trees: 193 owned files, 191 copied skill files, and 14 vendor files. Anchor, quoted-source,
and readability validators completed for all 193 owned files. A subsequent navigation call used the
wrong manifest shape; corrected it to the actual sections-based API without repeating the already
successful content validators.

All 77 public navigation paths occur in the documentation index. An inline relative-link scan,
excluding fenced and inline code, found no missing filesystem targets. It does not validate external
URLs, reference-style link syntax, image freshness, or semantic dead documentation. Remaining
source-side failures and incomplete product/UI/history reviews remain on the main audit list.

## Docker endpoint flags and daemon-wide mutations

Followed up the earlier Docker review against endpoint resolution, native connection, and prune
commands. Documented context fallback and that TLS environment/certificate metadata alone does not
change a TCP URL into a TLS transport. Qualified inventory/actions as daemon-wide and prune by
Docker's eligibility rules, rather than by chat/project or the displayed Compose group.

Sixteen host-resolution tests passed. A pure resolver probe with synthetic TLS environment values
confirmed plain HTTP selection for a TCP URL. No Docker daemon, certificate file, CLI, or network
request was accessed; native/CLI prune scope was inspected in source, not executed.

## Related guides

- [Documentation audit](documentation-audit.md)
- [Content reviews](documentation-audit-reviews.md)
- [Runtime reviews](documentation-audit-runtime-reviews.md)

# Documentation audit

This working record tracks the repository documentation audit started on 2026-10-09. Passing link
and formatting checks does not prove that every product claim matches the implementation.

## Scope

Review the root README and community files, public guides, internal references, package and plugin
READMEs, and repository workflow documentation. Keep vendored upstream documentation under its
upstream synchronization policy. Verify claims against code, defaults, tests, and current release
state; remove obsolete instructions and consolidate duplicated contracts.

## Evidence collected

| Review                  | Evidence and result                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory               | Refreshed working-tree inventory: 194 Markdown files outside imported skill/vendor trees, 191 copied skill files, and 14 vendor-tree files; 77 published pages. Includes staged and untracked additions; excludes deleted paths. |
| Public navigation       | The documentation index now links every page in `docs/public-nav.json`.                                                                                                                                                          |
| Local links and anchors | Initial `check:public` passed. Current anchor, quoted-source and readability checks passed across all 194 owned Markdown files; the earlier inline relative-link scan found no missing targets.                                  |
| Subsystem references    | `check:docs` resolved 217 source references in 24 tracked subsystem notes, with no allowlisted debt; the broader validator covered all owned Markdown.                                                                           |
| GitHub source links     | Checked first-party Markdown links to this repository's `blob/main` files against the checkout; repaired the moved file-tree parser link.                                                                                        |
| Quoted source paths     | Extended the landing validator to all owned Markdown for this audit; repaired two abbreviated desktop script paths.                                                                                                              |
| GitHub feedback         | Paginated repository-wide inline PR, issue/PR discussion, and commit-comment queries returned no comments. PR #14 has no submitted review; its proposed CI wording was compared with the current workflow.                       |
| Release state           | GitHub API returned two draft entries for `v0.1.0-beta.1`, neither published. Removed the installation guide's claim that the beta was public.                                                                                   |
| Reference documentation | Reviewed OpenCode, Cline, and Continue entry pages for task navigation and onboarding structure.                                                                                                                                 |
| Public generation       | Latest `bun run --cwd apps/landing generate` collected 77 pages and selected 37 current captures; no uncaptured placeholder slots remain.                                                                                        |

## Corrections made

- Rebuilt the documentation index around setup, task selection, grouped feature reference, extension
  authoring, and contributor references. It previously omitted 32 published pages.
- Added the isolated browser workflow to installation and contribution setup; distinguished its
  database from desktop and wider workspace development.
- Replaced clone placeholders, an obsolete evidence-ledger instruction, and inaccurate release
  availability language. Kept configured platforms separate from published assets.
- Aligned capture dimensions and source-section order with the repository workflow and validators.
- Removed the nonexistent composer tool-budget pill and the stale 4,900-token claim. Documented the
  core schema test ceiling separately from the actual run roster and extension tools.
- Added the model compatibility layer to tool availability; clarified agent-owned rules and the
  effective rules derived by conversation permission modes.

## Internal structure review

- Split desktop packaging into packaging/launcher ownership,
  [runtime lifecycle](desktop-runtime-lifecycle.md), and [browser integration](desktop-browser.md).
- Split [composer tip contracts](subsystems/composer-tips.md) from capability resolution, and
  [notification problems](subsystems/notification-problems.md) from journal and channel policy.
- Fixed the stale single-restart claim against `supervisor.rs`: recovery allows five restarts within
  three minutes, with bounded backoff and health probes.
- Updated the startup byte ceiling to 2,050,000 and qualified the manifest's five known platform
  keys: the current workflow requires only its three configured signed artifact entries.
- Removed obsolete numeric anecdotes and unsupported comparisons; shortened long prose while
  preserving current contracts. The 116 reviewed files (`docs/` guides and the Project Space README)
  passed the extended readability scan. This is structural evidence, not a complete content audit.

## Package contract review

All fourteen existing package READMEs were compared with current manifests, exported barrels,
implementation, consumers, and relevant existing regression cases. Documentation edits did not
change runtime code.

| Package                                                       | Reviewed contract and correction                                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Path containment](../../packages/path-containment/README.md) | Verified both exports, branded root-inclusive resolution, fail-closed empty input, and lexical-only checks. Existing README matches those contracts.                                                                             |
| [OS handoff](../../packages/os-open/README.md)                | Verified per-platform commands, opener exit versus app spawn, 15-second default timeout, target rejection, and optional logging. Removed the claim that logging is unconditional and narrowed the architecture guard's coverage. |
| [Liveness](../../packages/liveness/README.md)                 | Verified keyed ownership, defaults, report verification, and probe selection. Corrected negative-report semantics and distinguished HTTP reachability from status-based health.                                                  |
| [Notifications](../../packages/notifications/README.md)       | Corrected current UI transports and category-based interruption policy; aligned the subsystem guide with the same implementation.                                                                                                |
| [Source lint](../../packages/source-lint/README.md)           | Verified the root-only TypeScript export and scanner helpers. Qualified test-file filtering: `.test` filenames are skipped; `.spec` filenames are not.                                                                           |
| [Oxlint rules](../../packages/oxlint-rules/README.md)         | Verified all six registered error rules. Removed obsolete plugin keyboard exclusions and described the current source-loading boundary.                                                                                          |
| [CLI](../../packages/cli/README.md)                           | Verified arguments, shim loading, build output, and OS handoff. Corrected running-app and PATH claims; the public CLI guide now describes best-effort launcher refresh on desktop startup.                                       |
| [Agent contracts](../../packages/agent/README.md)             | Compared the export map with source barrels and image/context helpers. Added the missing history-strategy entry point.                                                                                                           |
| [Pi adapter](../../packages/agent-runtime-pi/README.md)       | Compared engine composition, root exports, event buffering, credentials, and catalog refresh. Added current engine/middleware helpers and refresh timing.                                                                        |
| [Data view](../../packages/dataview/README.md)                | Verified dependency-free exports, 200-row inference, pure queries, and the throwing XLSX declaration. Kept host I/O boundaries explicit and made source links repository-relative.                                               |
| [Markdown](../../packages/markdown/README.md)                 | Compared source exports, renderer props, HTML/math setup, and diagram handling. Replaced the incomplete example with a component that defines its source prop; documented source-level imports and host styling.                 |
| [Plugin SDK](../../packages/plugin-sdk/README.md)             | Compared the manifest, common backend/UI entries, optional host capabilities, and synchronization exports. Qualified the partial export table and distinguished typed bridges from runtime isolation.                            |
| [UI kit](../../packages/kit/README.md)                        | Verified source doors, catalog, stylesheet, test helpers, and example imports. Documented auxiliary exports and corrected checks in README and AGENTS.md to use root-safe Bun package scripts.                                   |
| [Visual Feedback](../../packages/visual-feedback/README.md)   | Compared all eight exports, probe/host helpers, panel actuation, and console buffering. Added missing panel/console entries and qualified document injection and host command authority.                                         |

## Plugin review

The directory index now covers all 21 current bundled manifests. The reviews below compare manifests
and the code owning documented behavior. Later sections cover the games and further workbenches;
Reader still needs its own content review.

| Guide                                                        | Evidence and correction                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bundled plugin index](../../plugins/README.md)              | Compared the manifest inventory, trust classifier, dependency planner, and developer watcher. Added missing workbenches and games, used current agent terminology, and replaced routine repository-wide check instructions with focused commands. |
| [Deliverables](../../plugins/deliverable/README.md)          | Compared the enabled-by-default manifest with hook registration, supported extensions, matcher, caps, and strip behavior. Corrected opt-in wording and stated parser limits.                                                                      |
| [Webhook Notifier](../../plugins/webhook-notifier/README.md) | Compared all seven payload hooks, filtering, signing, timeout, and error handling. Corrected default state and scoped failure suppression to a registration instance; an unset URL sends nothing.                                                 |
| [API Client](../../plugins/api/README.md)                    | Compared config types, request/import/export owners, and shared file-watcher synchronization. Removed the obsolete healthy-watcher poll and documented string-valued numeric settings.                                                            |
| [Kanban](../../plugins/kanban/README.md)                     | Compared action names, per-action input guards, ordered storage, and operation validation. Documented the empty-board fallback for unreadable or malformed files without implying preservation of those contents.                                 |
| [Code Graph](../../plugins/code-graph/README.md)             | Compared the seven tools and graph/camera hooks. Corrected polling: no idle snapshot timer with healthy signals, 1.5 seconds during indexing, 8 seconds for fallback and camera reports.                                                          |
| [Learning Studio](../../plugins/learning/README.md)          | Compared lesson validation, authoring guidance, generation claims, portable bundles, and course-change hooks. Distinguished recommended quiz counts from the cap and corrected the disconnected-feed fallback.                                    |

Removed the introductory guide's obsolete claim about a bundled penetration-testing plugin: no
current manifest owns that capability.

## Game and reference-workbench review

- Compared all five game tool action enums and classifiers with their README tables. Reads have
  effect `read`; game changes have effect `session`. Removed obsolete claims that every plugin
  schema appears on every model request.
- Verified the games' store and UI synchronization delegates against the System Overview frame.
  Corrected all five descriptions: no periodic read with a healthy feed; disconnected fallback is
  800 ms during agent activity or 4 seconds while idle. Added current source owners.
- Compared game-state transitions, Chess's local engine wrapper, Checkers capture/draw rules,
  Battleship projections, and 2048 plan execution. Qualified memory retention by agent policy and
  memory scope rather than promising that every saved observation survives its chat.
- Completed the Battleship instruction follow-up against game projections and tool batches.
  Corrected end-of-game fleet disclosure, board-versus-tool starter defaults, wake contents, and
  partial batch results. Thirty-seven focused rules/backend tests passed; a subsequent package
  command also ran its existing registration/layout and four DOM tests (46 passing tests total). DOM
  fixtures verify board-owned session routing, shots and reshuffle; no live model or browser session
  was used. Git history for the tool and game contract contains only their initial commit.
- Refined Learning's adaptation command and bundle guide against assessed-task revisions and module
  generation. Explanations/hints preserve unchanged assessments; stored quiz option order changes
  the revision. Documented the three-attempt cap and activity-driven recovery rather than a retry
  timer. Three focused service tests passed; an in-memory generator probe checked the 15-minute
  queued boundary and attempt exhaustion, and direct task-content probes checked revision fields.
  The relevant generator/revision history traces to the initial commit; no course was created in a
  user's session.
- Clarified plugin synchronization's separate file-resource and route-snapshot refresh contracts,
  live/fallback intervals, last-good snapshots, cooperative cancellation and eight-second request
  timeout. Four focused scheduler/path/DOM tests passed; in-memory probes confirmed one terminal
  error after four failed reads and waiter release without applying an uncancellable disposed read.
  Route mutation ordering and timeout behavior were checked in source, without a new DOM test for
  those paths. Relevant owner history includes `3a0d3c3`.
- Refined the plugin-route guide against the validator, host scope resolver and startup dispatcher.
  Documented headline/detail differences, malformed JSON outside the custom envelope,
  optional-schema acceptance of non-JSON input, and per-request `c.env` ownership. Qualified
  first-reconcile failure and the uncancelled late-scope scan. Sixteen focused
  validator/scope/startup tests passed; direct Hono requests confirmed malformed JSON, absent
  content type, unknown-field stripping and the all-optional text/plain case. Relevant owner history
  traces to the initial commit.
- Refined inbound webhook guidance against provenance framing, origin/Host policy and wake
  admission. Removed the direct slash-dispatch and priority-zero claims: wrapped slash text stays a
  prompt, and queued external turns use the default machine-wake band. Corrected concrete bind
  hosts, explicitly allowed browser origins and the client-header boundary. Thirty-six focused
  webhook, identity and origin-policy tests passed; direct framing and priority probes confirmed
  `/clear` is not parsed as a command and external/loop priorities are both 10. No real session was
  messaged. Reviewed `ecb6209` and initial owner history for the guide and request boundary.
- Reconciled SECURITY, privacy and desktop descriptions of local API access with the same origin
  policy and bootstrap wiring. Documented the explicit allowed browser origins, concrete bind-host
  exception and self-asserted user scope without implying process authentication. Reused the
  preceding request-boundary test evidence; these edits changed prose only. The repository-wide
  search found no remaining copies of the obsolete app-origin-only or loopback-Host-only claims.
- Added MCP's interactive sign-in and recovery workflow after inspecting Settings controls, callback
  routing, the encrypted store and pending-flow registry. Documented ten-minute/single-use
  callbacks, process restart and 64-flow eviction, interactive Streamable HTTP, and local sign-out
  without provider revocation. Twenty-three focused status/store/provider/registry tests passed. The
  actual provider consent and code-exchange round trip remains source-reviewed rather than
  live-tested; no browser, remote OAuth server or user credentials were used.
- Corrected Monitors' public `bash until` deadline: its tool schema accepts at most 600 seconds,
  despite the shared engine's one-hour ceiling. Values below 60 use the 300-second default.
  Documented the separate 5–30-second check timeout and stopped-poll result suppression without
  implying immediate cancellation. Twenty-four focused adapter/service tests passed; a real tool
  object with a fake wait host verified deadline normalization and rejection above 600 without
  executing shell commands. Relevant bash-schema history includes `e3101ca` and `6150d76`.
- Corrected Loops' fixed-versus-dynamic quota behavior, manual fire gate bypass, initial one-hour
  dynamic watchdog and failure-backoff floor. Qualified cancellation: only session-target wakes are
  withdrawn; an in-flight or concurrency-waiting child fire is not stopped by removing its schedule.
  Twenty-seven focused service/child/trigger/backoff tests passed; a real trigger-engine fixture
  confirmed manual gate bypass and child-fire survival after cancellation. The first probe used a
  nonexistent fixture session and was corrected to its seeded owner; no product session ran.
- Qualified Background work's promotion and update-confirmation claims against bash dispatch and the
  UI roster. Documented background deadline normalization and promotion without a new deadline. The
  update collector excludes every monitor row, not only resumed polls; the guide no longer promises
  a warning for stream watches. Eleven focused restart/collector/settle tests passed. Timeout and
  promotion behavior were source-reviewed; no new background process was started.
- Qualified HITL's deadlines and queued-answer delivery: the blocking clock starts on request
  creation, queued questions have no deadline, and a recalled queued question survives timeout or
  run cancellation. Recovery retries recent unanswered deliveries within the seven-day receipt
  horizon; admission is not proof that the agent acted. Twenty-eight controller/queued-ask/facade
  tests passed. Facade delivery uses fixtures; the horizon and decided-delivery branches were
  checked in source. Relevant owner history traces to the initial commit.
- Corrected Configure's unsupported stale-policy guard and Settings provenance claims. Current
  remedies apply switches without comparing a captured revision; tool rules retain origin while
  plugin/MCP provenance is in proposal audit rows. Documented separate application/status writes and
  shortened obsolete remedy history. Sixteen focused tool/registry tests passed; the real tool with
  a fake host confirmed a committed setting can report failure when final audit recording fails. No
  actual configuration was changed. Owner history traces to the initial commit.
- Compared System Overview ports and commands with its package and preview runner, sampling limits
  with its UI hook, and collectors with `backend/processes.ts`. Corrected the claim that process
  inspection uses no commands and aligned its contributor checks with focused repository practice.
- Reviewed Trading's tool effect classifier and registered roster. Replaced the stale all-read-only
  chart-call description in README and internals, added the policy boundary to the public guide, and
  qualified the default-venue tool roster. The stream/cache review is recorded below.

## Project Space, Trading streams, and fonts

- Compared Project Space's ordered file store, partial-operation batch, actor undo, path
  normalization, and UI synchronization with its README. Added the board path and tool effects,
  qualified record preservation, and documented the 100-entry process-local undo history.
- Compared Trading's ticker and stream delivery gates, hidden-tab teardown, stream-only trade tape,
  candle loading/backfill, and cache with its README. The cache limits targets to 12; it does not
  limit every series's candle count. Added the owning hooks as source evidence.
- Counted 60 bundled TTF files and 15 adjacent OFL licenses. Checked the local regular faces with
  fontkit: Courier Prime maps no U+0400–U+052F glyphs; neither Courier Prime nor Inter maps U+4E00.
  Replaced the blanket Unicode claim with the generator's actual fallback and rejection behavior,
  verified the upstream Inter/Tinos references, and removed unsupported conversion-history wording.

## Application README review

- Compared API exports, executable startup, environment defaults, request identity, and origin
  policy. Qualified the partial entry table and replaced the obsolete broad-loopback CORS wording
  with the explicit allowed-origin boundary.
- Compared the UI README with its package scripts, Vite configuration, and host module registry; its
  runtime address and source-module boundaries remain accurate. Reviewed the host kit README's
  directory ownership against the registry and catalog checks.
- Compared landing commands, styles, deployment configs, docs generation, and screenshot selection.
  Corrected the claim that the site never overrides product colors or fonts, clarified command
  location, and added source owners.
- Compared migration immutability and startup descriptions with the runner, ledger, and freeze.
  Replaced the instruction to run all repository gates locally with focused database tests.
- Compared desktop script checks, current capabilities, and OS-opening contracts. Corrected stale
  default-permission claims, repaired command names containing table delimiters, qualified optional
  logging in the shared opener, and moved source references after the native-tab section.
- Recent history for these owners includes `7a39321`, `23fade3`, and `e3101ca`; current source takes
  precedence over historical behavior. The detailed native-tab appendix still requires a full source
  comparison.

## Reader review

Compared Reader's manifest, format dispatch, explicit shelf, path containment, archive ceilings,
PDF/MOBI adapters, tool schema, resource expansion, browser storage, reading interactions, and stats
aggregates. Qualified PDF support as extracted reflowed text without OCR, split browser records from
backend library/statistics files, and documented source, archive, chapter, and context ceilings.
Corrected the daily trail to the last 14 active dates and described UTF-16 continuation offsets.
Recent plugin history was checked; all current plugin READMEs now have a content review recorded.

## Native workspaces and public Reader guide

- Compared native-tab menu labels/shortcuts, bounded frontend saves, last-workspace handling,
  hidden-group reopening, legacy session visibility, drag snapshot geometry, and Command+T
  reservation with their current owners. Compared the desktop README appendix's chrome, material,
  tab-control, routing, and smoke-check descriptions with source; inspected its Ghostty reference.
  This is a source audit, not a new live AppKit or screen-reader run.
- Consolidated the duplicated native-tab instructions into the dedicated public guide. Kept the
  workspace's existing native-tab anchor as a short overview and moved its conversation-context
  capture beside the instructions it demonstrates. Qualified save requests by their bounded budget.
- Applied the Reader source review to its public guide. Replaced the duplicated capability/roadmap
  matrix and contributor-layering section with user-facing storage and limits, related guides, and
  source owners. Removed unsupported future sequencing and audit-proof wording; corrected reflowed
  PDF support and the 14-active-date statistics trail.
- Inspected the shortcut preset inventory (17 choices), platform variants, and native reservation.
  Subsequent content reviews compare its focus/persistence claims and selected editor references;
  remaining external-editor comparisons and live evidence are still separate work.

## Incoming-link and ownership pass

The refreshed parsed Markdown-link graph identifies four non-entry files without incoming links: the
GitHub PR template and Learning's `adapt`, `create`, and `lesson` commands. GitHub consumes the
template by convention; the plugin loader discovers the three command files from its default tree.
The earlier pass also found Database architecture and three Resume records; these now have incoming
links from the bundled-plugin index or Resume cross-references.

The current parse covers inline, reference-style and HTML links; it excludes code fences, inline
code, conventional entry files, imported skills and vendor trees, including Tauri's nested GLib
directory. All 1,773 relative-link occurrences resolve to existing paths. This does not validate
external URLs or target anchors, prove semantic duplication, or establish every loader reference.
Kit brand attribution now has a link from its package README.

The imported skill packages are documented in the [project skills wrapper](../../.agents/README.md).
Their upstream provenance and Localix precedence are separate from first-party product guidance.
Vendor-owned documentation keeps its synchronization policy. No deletion was justified by this
incoming-link pass alone.

## Capture slots and coverage review

The two uncaptured slots were unused `workspace/craft` and `autonomy/background-work` artwork, with
no active consumer or scenario. Removed those assets and their unused homepage selection keys. The
generator now reports 37 current captures and zero uncaptured placeholder slots. Corrected the
screenshot README's obsolete missing-CLI claim and the capture workflow's help-versus-startup
wording.

The coverage tool found dated captures linked from the owning guides for all 18 workbench owners,
plus the separate Kubernetes provider. Twelve manifest tests passed, including native-pixel
preservation, dated selection, density guards, and archived-frame exclusion. Reviewed the agent
context/limits and external CLI captures at native size against their source/scenario. This does not
prove every current figure's freshness or replace live scenario checks.

Reviewed Reader and Trading's 4800×3000 originals against their scenarios. Reader demonstrates a
sample Markdown chapter; Trading shows dated Kraken one-hour candles, volume, and the order book.
Clarified their captions and recorded which assertions cover each frame. The post-capture changes in
`287f44e` affect Reader library covers and Trading indicator colour hover controls, neither visible
in these frames. No new capture run was performed; the order book has no scenario content assertion.

## Workflow follow-ups

The [workflow review record](documentation-audit-workflow-reviews.md) covers tool-budget scope,
conversation addressing/control, queue cancellation, and Stop settlement. It separates direct probes
and existing test coverage from live model behavior that was not exercised.

## Review checkpoints

- `b7d5b12`: application README runtime and permission corrections.
- `6c62bb4`: Reader README storage and parser limits.
- `37b3a2f`: native-tab consolidation and public Reader limits.
- `f3242c7`: package README exports and runtime contracts.
- `a569839`: plugin defaults, synchronization, storage, and font corrections.
- `db85164`: documentation index, contributor guidance, internal guide splits, and audit report.

These commits are intermediate checkpoints. They do not prove that the remaining public guides,
skill instructions, obsolete-page inventory, or visual evidence have completed their review.

## Detailed content reviews

The [content review record](documentation-audit-reviews.md) holds the source comparisons for
permissions, sessions, automation, privacy, MCP, plugin lifetimes, bundled skills, DevOps,
background work, plans, and Learning bundle examples. Keeping those records separate leaves this
page focused on scope, aggregate evidence, and unresolved work.

## Subsequent runtime and extension comparisons

The [runtime review record](documentation-audit-runtime-reviews.md) now covers provider/key and
model/effort selection, API workbench import/export, usage attribution, LSP recovery/edit scope,
storage/log/diagnostics troubleshooting, onboarding, execution adapters, answer formatting,
checkpoint/topic boundaries, history search/export, Git mutations, notification delivery, and
remaining chart recipes. These are source comparisons with scoped tests/probes, not a blanket claim
of live UI or provider integration coverage.

Sandboxed HTML bridge guidance is now a [separate authoring page](../extending/sandboxed-views.md)
with index/navigation ownership, explicit limits, and a compiled SDK example. CSP, storage, timeout,
and exact backend scope contracts were compared; native iframe loading remains distinct product
evidence. Signed checkpoint creation for the current batch remains outstanding.

## Maintenance follow-ups

[Maintenance reviews](documentation-audit-maintenance-reviews.md) record Kubernetes cache/apply,
DevOps mutation outcomes, root README privacy wording, and contribution/CI policy comparisons.
[Interface procedure reviews](documentation-audit-interface-reviews.md) record further comparisons
of practical controls, retry steps and their limits.

## Remaining work

These items are unresolved; the audit is not complete.

- **Public feature and extension claims:** compare remaining guides with source owners, route
  contracts, settings, and failure cases. Link checks alone do not establish accuracy.
- **Bundled skills:** finish unverified examples and interaction evidence against their tool
  contracts. Battleship's instruction contracts and four DOM interactions have been checked; seven
  chart entry/recipe snippets compile against the installed library, with date/DST probes recorded.
- **Git history:** repository-wide comment queries found no feedback. Review relevant implementation
  history as each remaining guide is audited; unmerged PR bodies are proposals, not product
  evidence.
- **Dead and duplicated documentation:** trace incoming references and implementation ownership
  before deleting or merging a page.
- **Product evidence:** finish figure freshness comparisons against current source and owning
  scenarios. Placeholder cleanup and coverage metadata are not complete live UI evidence.
- **Core schema budget:** the current composed 23-tool fixture estimates 7,507 tokens and fails its
  7,500-token ceiling. The tools guide labels this as a test ceiling; the threshold was not relaxed.
- **Permission guard test:** its position assertion treats the later `agents` denial as a tool
  allowance. It fails even though direct backend-preset checks still ask for both guarded calls.
- **Final verification:** run affected documentation checks, verify index/navigation agreement, and
  review the final diff. Complete the audit only after the content review is finished.

## Related guides

- [Documentation index](../README.md)
- [Documentation standards](doc-standards.md)
- [Detailed content reviews](documentation-audit-reviews.md)
- [Runtime content reviews](documentation-audit-runtime-reviews.md)
- [Workflow content reviews](documentation-audit-workflow-reviews.md)
- [Capture workflow](../../scripts/screenshots/README.md)

## Source of truth

- [Public navigation](../public-nav.json)
- [Public documentation validator](../../apps/landing/scripts/build-docs.mjs)
- [Repository hygiene check](../../scripts/check-public-repo.mjs)
- [Subsystem reference validator](../../scripts/check-doc-refs.mjs)
- [Release workflow](../../.github/workflows/release.yml)
- [OpenCode documentation](https://opencode.ai/docs/)
- [Cline overview](https://docs.cline.bot/cline-overview)
- [Continue documentation](https://docs.continue.dev/)

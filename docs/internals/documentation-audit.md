# Documentation audit

This working record tracks the repository documentation audit started on 2026-10-09. Passing link
and formatting checks does not prove that every product claim matches the implementation.

## Scope

Review the root README and community files, public guides, internal references, package and plugin
READMEs, and repository workflow documentation. Keep vendored upstream documentation under its
upstream synchronization policy. Verify claims against code, defaults, tests, and current release
state; remove obsolete instructions and consolidate duplicated contracts.

## Evidence collected

| Review                  | Evidence and result                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory               | 185 first-party Markdown files in the current audit, including bundled skill instructions and new internal references; 75 published pages.                                                                 |
| Public navigation       | The documentation index now links every page in `docs/public-nav.json`.                                                                                                                                    |
| Local links and anchors | `check:public` passed; the landing generator's anchor and quoted-source validators passed across all 185 owned Markdown files.                                                                             |
| Subsystem references    | `check:docs` resolved 217 source references in 24 tracked subsystem notes, with no allowlisted debt; the broader validator covered all owned Markdown.                                                     |
| GitHub source links     | Checked first-party Markdown links to this repository's `blob/main` files against the checkout; repaired the moved file-tree parser link.                                                                  |
| Quoted source paths     | Extended the landing validator to all owned Markdown for this audit; repaired two abbreviated desktop script paths.                                                                                        |
| GitHub feedback         | Paginated repository-wide inline PR, issue/PR discussion, and commit-comment queries returned no comments. PR #14 has no submitted review; its proposed CI wording was compared with the current workflow. |
| Release state           | GitHub API returned two draft entries for `v0.1.0-beta.1`, neither published. Removed the installation guide's claim that the beta was public.                                                             |
| Reference documentation | Reviewed OpenCode, Cline, and Continue entry pages for task navigation and onboarding structure.                                                                                                           |
| Public generation       | `bun run --cwd apps/landing generate` collected 75 pages and selected 37 current captures; two placeholder slots remain.                                                                                   |

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
  The original page now has 332 lines.
- Split [composer tip contracts](subsystems/composer-tips.md) from capability resolution, and
  [notification problems](subsystems/notification-problems.md) from journal and channel policy. The
  owning capability and notification pages now have 346 and 329 lines.
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
  The public keyboard guide still needs its detailed focus/persistence claims and external
  references checked before its content review is complete.

## Review checkpoints

- `b7d5b12`: application README runtime and permission corrections.
- `6c62bb4`: Reader README storage and parser limits.
- `37b3a2f`: native-tab consolidation and public Reader limits.
- `f3242c7`: package README exports and runtime contracts.
- `a569839`: plugin defaults, synchronization, storage, and font corrections.
- `db85164`: documentation index, contributor guidance, internal guide splits, and audit report.

These commits are intermediate checkpoints. They do not prove that the remaining public guides,
skill instructions, obsolete-page inventory, or visual evidence have completed their review.

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

## Remaining work

These items are unresolved; the audit is not complete.

- **Public feature and extension claims:** compare remaining guides with source owners, route
  contracts, settings, and failure cases. Link checks alone do not establish accuracy.
- **Bundled skills:** review the long Battleship block and 632-line chart reference for structure,
  accuracy, and ownership before editing or splitting them.
- **Git history:** repository-wide comment queries found no feedback. Review relevant implementation
  history as each remaining guide is audited; unmerged PR bodies are proposals, not product
  evidence.
- **Dead and duplicated documentation:** trace incoming references and implementation ownership
  before deleting or merging a page.
- **Product evidence:** review the two reserved capture slots and figure freshness. A placeholder is
  not UI evidence.
- **Final verification:** run affected documentation checks, verify index/navigation agreement, and
  review the final diff. Complete the audit only after the content review is finished.

## Related guides

- [Documentation index](../README.md)
- [Documentation standards](doc-standards.md)
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

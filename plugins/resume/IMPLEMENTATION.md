# Resume plugin completion record

This record separates implemented behavior from remaining work. Lanjut is the behavioral reference;
Localix owns the integration, persistence and component system. Template renderers are original
implementations of the reference directions, not copied source.

| Requirement                                | Current implementation                                                                                                 | Evidence / remaining work                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent initializes a resume from a template | One `resume` tool, `init` action, six template IDs                                                                     | `backend/tool.test.ts` checks every template and its canonical file                                                                                                     |
| Canonical project files                    | `.localix/resumes/<id>/resume.json`                                                                                    | `backend/service.test.ts` checks restart and ordinary file edits                                                                                                        |
| Shared user and agent edits                | File-content revision, atomic operation batch, scoped routes                                                           | Service concurrency and mounted-route tests                                                                                                                             |
| Workspace isolation                        | Session-scoped tabs and verified session root for resources                                                            | `backend/context.test.ts` and service containment tests                                                                                                                 |
| Recoverable history                        | Saved snapshots under each resume's `history/`; restore creates a new revision                                         | `ui/HistoryPanel.dom.test.tsx` verifies selection, confirmation, new-head rendering and context cleanup                                                                 |
| Local editing history                      | Undo/Redo and local draft recovery                                                                                     | `ui/useResumes.dom.test.tsx` checks recovery, same-field conflict and independent merge                                                                                 |
| Structured sections                        | Header, summary, experience, internship, projects, organizations, education, certifications, skills, languages, custom | `shared/schema.test.ts` verifies section semantics and guards; field accessibility verified by `ui/validation.dom.test.tsx`                                             |
| Reference templates                        | Awal, Ketat, Luasa, Tebal, Klasik, Ketik selectable                                                                    | Six template directions, selectable typography and embedded Unicode export are implemented; `shared/presentation.test.ts` and Documents layout tests cover the contract |
| Canonical reading order                    | One block projection for preview and text/Markdown                                                                     | `shared/format.test.ts` checks every template, hidden/empty gating, context exclusion and URL escaping                                                                  |
| Interactive editor                         | Kit controls, reordering, visibility, links, role context; restricted rich descriptions                                | Kit DOM tests cover formatting, safe HTML insertion, limits, Field semantics and external-revision Undo; backend rich-text test covers file/export/history              |
| Adaptive editor workspace                  | Full-height adjacent panels at 56rem of pane width; preview button beside Save; mounted editor retained                | `ui/ResumeCanvas.dom.test.tsx` checks resizing, preview visibility and explicit grid placement, draft/instance/scroll retention; no top/bottom split                    |
| Page preview and exports                   | Actual PDF pages in preview; PDF/DOCX share typed document layout                                                      | PDF artifact rendering and selectable-text checks; DOCX is linear and may paginate differently                                                                          |
| Context and bindings                       | Scoped resources, section references, labeled draft/history snippets                                                   | Provider regression and Workspace/HistoryPanel DOM tests cover publication, inactive-tab cleanup, recovery and unmount                                                  |
| Fresh install                              | Empty library and creation without a trailing-slash 404                                                                | `ui/api.test.ts`; full live opening still needs verification                                                                                                            |
| Documentation and packaging                | Manifest, agent skill, workspace lockfile, shared rich-text SDK and kit                                                | Resume UI/backend build against staged kit verified; public guide, catalog entry and dated UI captures are present                                                      |

[The reference contract](REFERENCE.md) records the adapted workflow. PDF pagination is owned by
Documents and preview renders those PDF bytes; Word retains a linear editable reading order.

## Adaptive workspace verification — 2026-10-07

- Chromium inspection in the running workbench: viewport widths 1600, 1100, 800, 620, 390 and 320px;
  editor, preview and template gallery remain reachable without horizontal overflow. Editing at
  320px also keeps the unsaved status and toolbar within the viewport.
- Root text size increased to 20px: the automatic preview mode follows the available pane width.
  Explicit button choices survive resizing.
- Dark and light captures with illustrative content:
  [wide editor](../../docs/assets/screenshots/resume/editor-wide--2026-10-07.png) and
  [light editor](../../docs/assets/screenshots/resume/editor-light--2026-10-07.png).
- Focused Canvas/Workspace DOM tests, plugin type check, edited-source lint and token/ground guards
  pass. The DOM resize test retains the rich editor instance, draft and scroll across view changes.

Viewport resizing verifies layout, not physical-device touch gestures. Template directions are
adapted to Localix; the subsequent export checks cover pagination, typography and Unicode.

## Compact UI refinement — 2026-10-07

The library uses Kit compact list rows (32px minimum), an inline search/new toolbar, edit dates,
optional target roles, and always-reachable secondary menus. It no longer fetches full documents for
gallery thumbnails. A 20-item illustrative library was inspected at 1600px and 320px; search,
keyboard opening, and the Rename dialog worked without horizontal overflow.

Preview has one pressed-state button beside Save. Automatic mode shows the preview when the pane is
at least 56rem; narrow panes start with the editor. An explicit toggle overrides automatic mode
across resize. Both panels stay in the same explicit grid row; the form remains mounted. Toolbar
height stayed 36px for clean and dirty drafts at tested viewport widths from 320px to 1600px.
Workspace and Canvas DOM tests check automatic/manual modes and draft/scroll retention; the row DOM
test checks independent menu actions and pending-state disabling.

## Synchronization and exports

The shared SDK file coordinator replaces the five-second healthy poll. Native edits invalidate the
saved snapshot; the existing draft merge and revision checks remain. SDK tests cover invalidation
during reads, watcher loss, fallback and teardown. Export tests cover hidden-proficiency skill
content. The reviewed agent result passed schema validation and actual PDF/Word content checks.

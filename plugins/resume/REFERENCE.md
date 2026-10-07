# Resume reference contract

Lanjut and the three supplied screenshots define the creation and editing flow. Localix supplies the
workbench shell, theme and shared controls. The flow must not be replaced by a toolbar menu.

| Surface     | Required behavior and composition                                                                                                                                                                                | Acceptance evidence                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Library     | Compact saved-resume rows, search and New resume; empty state with Browse templates and New resume                                                                                                               | Live empty and populated library captures                       |
| Creation    | Modal with name, Sample / Blank / Import a file, six visible template thumbnails, selection, Cancel and Create resume                                                                                            | Live modal capture and creation interaction test                |
| Templates   | Awal, Ketat, Ketik, Klasik, Luasa, Tebal; real document thumbnails using the corresponding presentation                                                                                                          | Rendered comparison against reference directions                |
| Editor      | Wide pane: preview left, collapsible editor right, both full height. Narrow pane: preview button beside Save switches the visible view; never a top/bottom split. Editor / Layout / Document tabs; undo and redo | Live populated editor, narrow views and resize interaction test |
| Document    | Visible page boundaries and page numbers; PDF keeps the selected presentation                                                                                                                                    | Multi-page preview and exported artifact comparison             |
| Integration | Same canonical project file for agent and UI; truthful draft/history context; no loss on conflicts                                                                                                               | Existing service tests plus full creation/edit/save interaction |

Sample content is explicitly illustrative. Blank creation and agent initialization must not invent
the user's qualifications. Arbitrary source files remain the agent's ingestion responsibility;
portable structured resume JSON can be imported directly into the creation form.

The current implementation is incomplete until these surfaces have been rendered and compared.

## Reference review — 2026-10-07

The editor layout follows the requested Localix adaptation rather than reproducing Lanjut's shell.
The user requested compact library rows instead of document cards and one preview button instead of
a separate view tab bar. The breakpoint uses the resume pane's width (56rem), including resizing
beside chat and changes to the root text size. The preview button keeps the editor mounted,
preserving its draft, panel selection and scroll position. Preview opens automatically above the
pane breakpoint until the user explicitly chooses a mode. Template selection stays available through
Layout; New resume remains available through More when its toolbar action is collapsed.

The reference also contains capabilities that the current plugin has not implemented:

- Measured A4 pagination, page numbers and matching template presentation in PDF. The current
  preview is explicitly continuous; PDF and DOCX use the Documents plugin's linear typography.
- Document font selection, font-size scales, line height, tracking and section spacing.
- Optional portrait with size, corner radius and alignment controls; contact icon visibility.
- Skills/languages column and proficiency visibility controls; separate rich/list custom sections.
- Month/year pickers, automatic date ordering and a section-order reset.
- Lanjut JSON/YAML interchange and its source-import leftovers review. Localix currently imports its
  own portable structured JSON; arbitrary source ingestion is handled by the agent.

These are parity gaps, not claims of completed functionality. Keep schema changes and template
export work together so presentation controls cannot promise a result that the exported document
ignores.

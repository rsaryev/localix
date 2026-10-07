# Resume reference contract

Lanjut and the three supplied screenshots define the creation and editing flow. Localix supplies the
workbench shell, theme and shared controls. The flow must not be replaced by a toolbar menu.

| Surface     | Required behavior and composition                                                                                     | Acceptance evidence                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Library     | My resumes heading, search, New resume action, deliberate empty state with Browse templates and New resume            | Live empty and populated library captures                       |
| Creation    | Modal with name, Sample / Blank / Import a file, six visible template thumbnails, selection, Cancel and Create resume | Live modal capture and creation interaction test                |
| Templates   | Awal, Ketat, Ketik, Klasik, Luasa, Tebal; real document thumbnails using the corresponding presentation               | Rendered comparison against reference directions                |
| Editor      | Document pages on the left; collapsible sections on the right; Editor / Layout / Document tabs; undo and redo         | Live populated editor and narrow layout captures                |
| Document    | Visible page boundaries and page numbers; PDF keeps the selected presentation                                         | Multi-page preview and exported artifact comparison             |
| Integration | Same canonical project file for agent and UI; truthful draft/history context; no loss on conflicts                    | Existing service tests plus full creation/edit/save interaction |

Sample content is explicitly illustrative. Blank creation and agent initialization must not invent
the user's qualifications. Arbitrary source files remain the agent's ingestion responsibility;
portable structured resume JSON can be imported directly into the creation form.

The current implementation is incomplete until these surfaces have been rendered and compared.

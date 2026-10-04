# Turn a vague goal into session tasks

Use the chat's Kanban board to make a goal visible and durable without coupling planning to
execution. The board comes from the bundled Kanban plugin; the
[Kanban guide](../features/task-board.md) owns its statuses and rules.

1. Create an epic and its task cards in the current chat. Add acceptance criteria and only the
   dependencies that represent real ordering constraints. One `kanban` `create` batch can wire a
   dependency to an earlier entry by its title.
2. Mark prepared cards `ready`. This records readiness; it does not start work.
3. To do the work itself, an agent takes one ready card with
   `kanban { action: "take", task_id: "LX-…" }`. The host records the agent whose turn it is as the
   owner, and the take is refused while a dependency is not `done`.
4. To delegate instead, the agent reads the card with `kanban { action: "detail", task_id: "LX-…" }`
   and writes it into a self-contained brief:
   `agents { action: "delegate", agent: "@qa", title: "…", prompt: "…" }`. Delegation knows nothing
   about the board; the card stays the parent's.
5. The parent agent reviews the report, then records the outcome with `kanban` `complete`. If
   progress is impossible, it records the reason with `block`.
6. Repeat for the tasks that `complete` names as newly unblocked.

The board remains useful across turns because tasks, dependencies, checklists, and results persist
with the chat. There are no worker lanes, automatic attempts, dispatch polling, or global cards to
reconcile, and deleting the chat deletes its board.

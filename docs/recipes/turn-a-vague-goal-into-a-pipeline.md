# Turn a vague goal into session tasks

Use the chat's Kanban board to make a goal visible and durable without coupling planning to
execution. The board comes from the bundled Kanban mini app; the
[Kanban guide](../features/task-board.md) owns its statuses and rules.

1. Create an epic and its task cards in the current chat. Add acceptance criteria and only the
   dependencies that represent real ordering constraints. One `kanban` `create` batch can wire a
   dependency to an earlier entry by its title.
2. Mark prepared cards `ready`. This records readiness; it does not start work.
3. To do the work itself, an agent takes one ready card with
   `kanban { action: "take", task_id: "LX-…" }`. The host records the agent whose turn it is as the
   owner, and the take is refused while a dependency is not `done`.
4. For work another agent should do, or for isolated side work, read the card with
   `kanban { action: "detail", task_id: "LX-…" }` and hand it to a subagent (`Agent`) with its
   scope, dependencies, and acceptance criteria as the task. The child sees only that task, not the
   board; the card stays the parent's to complete or block.
5. The parent agent reviews the report, then records the outcome with `kanban` `complete`. If
   progress is impossible, it records the reason with `block`.
6. Repeat for the tasks that `complete` names as newly unblocked.

The board remains useful across turns because tasks, dependencies, checklists, and results persist
with the chat. The board itself has no execution queue or automatic attempts. Delegated tasks use
separate child-session lanes; marking a card ready or assigning an owner does not enter those lanes.
Deleting the chat removes its board.

## Delegate a prepared task

Use a root chat; `Agent` is on by default for every shipped agent. For example, a
documentation-check card becomes this input:

```json
{
  "title": "Check documentation links",
  "task": "Check local Markdown links from docs/README.md in the current workspace. Report each missing target with its source file and link. Do not change files. Finish when every local link in that page has been checked; identify anything you could not verify."
}
```

Replace the title and task with the actual card's work. The child starts from the task alone, so the
task states everything it needs: the goal, its inputs and when it is done. Add `"agent"` to give the
card to a directory specialist instead of running it yourself. The parent checks the returned report
before marking its card complete. Schedule dependent work only after its prerequisite is verified.

## Related guides

- [Kanban](../features/task-board.md)
- [Subagents](../features/delegation.md)

## Source of truth

- [Agent input schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/agent/agent-tool.ts)
- [Subagent admission](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/agent/agent-start.ts)
- [Board tool actions](https://github.com/rsaryev/localix/blob/main/mini-apps/kanban/backend/tools.ts)

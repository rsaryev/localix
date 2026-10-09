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
4. For work another participant should do in this conversation, give it a turn with
   `conversation_control`. For isolated work, read the card with
   `kanban { action: "detail", task_id: "LX-…" }` and copy its scope, dependencies, and acceptance
   criteria into a self-contained `agents` `delegate` task. Delegation does not read the parent's
   board or conversation; the card stays the parent's to complete or block.
5. The parent agent reviews the report, then records the outcome with `kanban` `complete`. If
   progress is impossible, it records the reason with `block`.
6. Repeat for the tasks that `complete` names as newly unblocked.

The board remains useful across turns because tasks, dependencies, checklists, and results persist
with the chat. The board itself has no execution queue or automatic attempts. Delegated tasks use
separate child-session lanes; marking a card ready or assigning an owner does not enter those lanes.
Deleting the chat removes its board.

## Delegate a prepared task

The `agents` tool is off by default. Enable it for the delegating agent in **Settings → Capabilities
→ Tools**, and use a root chat. Select an available assignee; a fixed conversation accepts only
agents already present. For example, a documentation-check task has this input shape:

```json
{
  "action": "delegate",
  "tasks": [
    {
      "agents": ["@qa"],
      "title": "Check documentation links",
      "prompt": "Check local Markdown links from docs/README.md in the current workspace. Report each missing target with its source file and link. Do not change files. Finish when every local link in that page has been checked; identify anything you could not verify.",
      "priority": "normal"
    }
  ]
}
```

Replace the assignee and brief with the actual card's work. Each task requires `agents`, `title`,
`prompt`, and `priority`. The parent checks the returned report before marking its card complete.
Schedule dependent work only after its prerequisite is verified; a request to QA is not evidence
that QA has run.

## Related guides

- [Kanban](../features/task-board.md)
- [Delegation](../features/delegation.md)
- [Conversation handoffs](../features/conversations.md#passing-work-between-agents)

## Source of truth

- [Agents input schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/agents.ts)
- [Delegation admission](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/task-delegation.ts)
- [Board tool actions](https://github.com/rsaryev/localix/blob/main/plugins/kanban/backend/tools.ts)

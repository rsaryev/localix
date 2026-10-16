# Go

`/go` hands a goal to a team. You describe what you want in your own words; the agent plans it on
the chat's [Kanban board](task-board.md), picks the specialists it needs and, once you approve,
coordinates them until the work is done.

## Use it

```text
/go ship a pricing page with a working checkout
```

| Step    | What the agent does                                                                          |
| ------- | -------------------------------------------------------------------------------------------- |
| Scope   | Sends research to a [fork](delegation.md) and asks `@human` only what would change the plan. |
| Plan    | Creates one epic with 3–8 tasks, checklists and dependencies on the board.                   |
| Staff   | Reuses [specialists](agents.md), creates one only for a missing role (≤ 4), assigns cards.   |
| Approve | Shows the tasks, owners and parallel work, then waits for your explicit approval.            |
| Run     | @mentions each ready owner with its card, independent cards together.                        |
| Close   | Verifies cards in review, completes the epic and summarizes the result.                      |

The coordinator is the chat's leader: it sees the whole board and keeps its own context small by
sending reading and checking to forks. Every other agent sees only the cards assigned to it, and its
finished card waits in **Review** until the leader verifies it. Cards only you can do are assigned
to `@human`.

Reply to the plan to change it: drop a task, swap an owner, or approve it as it is. Nothing starts
before you answer.

## Boundaries

| Area        | Behavior                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| Tools       | `/go` adds no tool or permission; every action goes through your usual approvals.   |
| Board       | The board only records the plan. Cards never start a run.                           |
| No board    | With the Kanban plugin off, the plan is written in the reply.                       |
| Specialists | New ones are named after a profession and stay in your registry for later chats.    |
| Plugin      | Bundled as **Go**, on by default; turn it off in Settings → Capabilities → Plugins. |

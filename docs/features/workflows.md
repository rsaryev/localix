# Workflows

`/workflows` hands a goal to a team. You describe what you want in your own words; the agent breaks
it into cards on the chat's [Kanban board](task-board.md), picks the specialists it needs and
coordinates them until the work is done.

## Use it

```text
/workflows ship a pricing page with a working checkout
```

| Step       | What the agent does                                                                        |
| ---------- | ------------------------------------------------------------------------------------------ |
| Break down | Creates one epic with 3–8 tasks, checklists and dependencies on the board.                 |
| Staff      | Reuses [specialists](agents.md), creates one only for a missing role (≤ 4), assigns cards. |
| Run        | @mentions each ready owner with its card, independent cards together.                      |
| Close      | Verifies cards in review, completes the epic and summarizes the result.                    |

The coordinator is the chat's leader: it sees the whole board and keeps its own context small by
sending reading and checking to forks. Every other agent sees only the cards assigned to it, and its
finished card waits in **Review** until the leader verifies it. Cards only you can do are assigned
to `@human`.

`/workflows` does not ask you to approve a plan: whether the agent plans first and waits for you is
set by the chat's [permission mode](permission-modes.md). In Plan mode it proposes the breakdown and
starts after you approve it; in the other modes it starts right away, and you can redirect it at any
time.

## Boundaries

| Area        | Behavior                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------ |
| Tools       | `/workflows` adds no tool or permission; every action goes through your usual approvals.   |
| Board       | The board only records the plan. Cards never start a run.                                  |
| No board    | With the Kanban plugin off, the plan is written in the reply.                              |
| Specialists | New ones are named after a profession and stay in your registry for later chats.           |
| Plugin      | Bundled as **Workflows**, on by default; turn it off in Settings → Capabilities → Plugins. |

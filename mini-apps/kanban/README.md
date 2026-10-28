# Kanban board

A passive task board per chat: epics, tasks, dependencies, checklists, owners and blockers, kept by
the person and the agent in that chat. The board records work; it never starts it. The product page
is [docs/features/task-board.md](../../docs/features/task-board.md).

## One board per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat removes it. It is stored as `board.json` in the chat's session
storage (`ctx.sessionStorage`), which the host deletes with the chat. Every route and the tool act
on the chat the board belongs to — `c.env.sessionId` in a route (set only once the host checked the
user owns it), the call's own session in the tool.

## Writes

Every write is a pure operation from one board value to the next (`backend/operations.ts`): it
validates and then writes, so a refusal changes nothing. `backend/store.ts` runs them one at a time
per board and announces the change only after it is on disk. The queue and the listeners live on
`globalThis`, because the host imports the mini app afresh for every run's tools and the tool's
writes must still reach the board a person has open.

## The agent's tool

One tool, `kanban`, with an `action`: `list`, `search`, `create`, `update`, `take`, `complete`,
`block`, `reorder`, `delete`, `detail`. `take` records the agent the host names for the call, never
a name from the input. A card another agent should do is handed over with a turn; isolated side work
can go to a subagent with `Agent`, using `detail` as its prompt. The board never runs it.

Each move has one action: `take` (dependencies, owner) reaches `in_progress`, `complete` reaches
`done`, `block` reaches `blocked`; `update` edits a card and moves it only to `backlog`, `ready` or
`cancelled`. `update items` replaces the checklist, and `{ text, done }` ticks an item. A field an
action does not read is refused by name (`backend/tool-input.ts`), never dropped. An epic is closed
with `complete` too; the completion that finishes its last task names it.

The conversation's agent reads and edits the whole board. `complete` moves a card to `done` (a
person moves cards to `review` on the board). Reassigning an `in_progress` or `review` card resets
it to `ready` for its new owner.

## Limits

- A missing, unreadable, or invalid board file reads as an empty board. A later successful write can
  replace it; the store does not preserve malformed file contents or repair them.
- A completed card is a recorded result, not independent verification. The board starts no work.
- Pure-operation validation failures write nothing. Filesystem write failures reject before events
  are announced.

## Layout

| Location                | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `shared/contracts.ts`   | The board, card and request schemas; every type derives from one.    |
| `shared/rules.ts`       | Which moves each actor may make, and when a card can be taken.       |
| `shared/resource.ts`    | Routes, work-item kinds, the live stream and the board's URIs.       |
| `shared/tool.ts`        | The tool's name, actions and result details.                         |
| `backend/operations.ts` | Every write as a pure function.                                      |
| `backend/store.ts`      | One board file: ordered writes, atomic saves, announcements.         |
| `backend/service.ts`    | Input validation, agent assignment, one operation per write.         |
| `backend/tools.ts`      | The `kanban` tool.                                                   |
| `backend/tool-input.ts` | Which fields each action reads; the moves `update` leaves to others. |
| `backend/describe.ts`   | The board as the model reads it; card reference resolution.          |
| `backend/routes.ts`     | The view's routes.                                                   |
| `backend/ws-frames.ts`  | The live stream, checked against the socket's user.                  |
| `backend/references.ts` | The `@resource:` provider and the search provider.                   |
| `ui/register.tsx`       | Work items, rail, anchors, search, tool card, composer strip.        |

## Source of truth

- [Mini app manifest](mini-app.json)
- [Action vocabulary](shared/tool.ts)
- [Per-action fields and status guards](backend/tool-input.ts)
- [Ordered storage and read fallback](backend/store.ts)
- [Pure board operations](backend/operations.ts)

# Repeat work on a schedule

A loop runs one task again and again in a session: every weekday at nine, every five minutes, or at
a pace the agent sets after each run. The agent creates it with the `loops` tool, or you ask for one
with `/loop`. Loops are stored in the database and survive an API restart.

## Terminology

| Term         | Meaning                                                                         | Boundary                                                                  |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fixed loop   | Fires on a 5-field cron, read in the time zone it was created in.               | A slot the session cannot take is skipped, not replayed later.            |
| Dynamic loop | Fires after a delay the agent chooses each time with `reschedule` (60–3,600 s). | It keeps firing at its last delay until it is removed.                    |
| Target       | `session` runs the task in this conversation; `subsession` in a fresh child.    | Only a fixed loop can use `subsession`: a child cannot reschedule itself. |
| Owner        | The participant that created the loop. Its fires are addressed to that agent.   | If the owner has left the conversation, the conversation chooses.         |
| Hold         | A fire waiting because the session is busy or the owner's quota is exhausted.   | A quota hold is stored, so a restart does not fire into the same quota.   |

## What you can do

| Need                  | Mechanism                                                                  | Boundary                                                               |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Start one             | `/loop <task>`, or ask the agent; it calls `loops` with `action="add"`.    | The same task, cadence and target is one job; a repeat add returns it. |
| See what is scheduled | The composer strip lists cadence, next run, run count and the last result. | The agent sees the same list through `loops` with `action="list"`.     |
| Run one now           | The strip's Run button, or `loops` with `action="run"`.                    | An extra run: it does not use up a fixed loop's next slot.             |
| Cancel one            | The strip's Cancel button, or `loops` with `action="remove"`.              | Cancels only this loop's own run in flight, nothing else.              |

## How a loop behaves

### When a fire cannot run

For `target: session`, a conversation busy with another turn does not take a loop fire on top of it.
A fixed loop gives that slot up and fires at the next one. A dynamic loop keeps its fire waiting and
runs it as soon as the session is idle.

A fixed `target: subsession` loop starts a fresh child through its own runner. It does not use the
parent-session busy or quota gate described here; the child still faces ordinary provider and
runtime limits.

A quota is tracked per provider route — the provider connection and the model on it — not per
conversation. When a run fails because a provider reports a rate limit, fires addressed to a
participant on that route wait until the cooldown ends, while participants on other routes keep
firing. A temporary rate limit holds that one model; an exhausted plan or credit balance holds every
model on that connection. A loop whose owner has left waits only while every participant's route is
exhausted, because the conversation may choose any of them. The strip shows the time the hold ends.

### When fires fail

A fixed loop that keeps failing waits longer between attempts — one minute, then two, four, up to an
hour — and returns to its schedule after the first success. A dynamic loop keeps the pace the agent
set; the agent sees the error in the loop list.

### After a restart

A fixed loop with an overdue stored slot makes at most one catch-up attempt after restart, then
computes its next slot from the current time. Busy/quota gates still apply; missed slots do not form
a replay backlog. A dynamic loop resumes its stored due time and continues at its last delay unless
the agent reschedules it. Failure-backoff streaks are in memory and reset on restart.

### Cancelling

Run now refuses to overlap a fire already in progress.

Cancelling a loop removes its fire from the queue if it is waiting, or stops that run if it is
running. Other messages in the queue and sub-agents started by other work keep going.

## Related guides

- [Wait for something to happen](monitors.md)
- [Hooks and commands](hooks-and-commands.md)

## Source of truth

- [Loop creation and cancellation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/loops/service.ts)
- [Target routing and fire gates](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/loops/action.ts)
- [Fixed schedule and restart policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/kinds/cron.ts)
- [Dynamic delay and watchdog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/kinds/delay.ts)
- [Trigger lifecycle and manual fires](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/engine.ts)
- [Failure backoff](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/backoff.ts)

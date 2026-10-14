/**
 * A live stream: a long-running command whose output lines are the events. It has no moment of
 * its own — it fires when its host reports a batch of lines — so it is an EVENT kind.
 *
 * Its source is a process the server owns, and that process does not survive a restart. So a
 * restart ENDS the trigger with `restart` and its action tells the owner once: a watch that
 * silently stopped watching would leave the agent waiting on lines that can never arrive.
 *
 * Flooding is decided upstream, before an event reaches this kind, because the right answer
 * depends on who asked for the stream: an agent's watch is STOPPED when its filter is too loose
 * (`features/monitors/batch.ts`), while a plugin's session-less watch DROPS the excess and keeps
 * running (`features/plugins/monitor-stream.ts`). The kind only says when a fire happens.
 */
import type { TriggerKind } from '../contracts'

export const streamKind: TriggerKind = {
  id: 'stream',
  clock: 'event',
  onRestart: 'end',
  firstDue: () => null,
  nextDue: () => null,
  onGated: 'hold',
  backsOff: false,
}

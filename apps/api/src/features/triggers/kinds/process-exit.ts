/**
 * A process's exit: the one event a `bash notify` job or an `asyncRewake` hook is armed for.
 *
 * An EVENT kind — the exit has no moment anyone can compute — and fired once: its action ends the
 * trigger with the fire, so the notice is exactly one delivery keyed `trg:<id>:1`, and a repeated
 * exit report finds the trigger gone. The process is the server's own child, so a restart ENDS the
 * trigger with `restart`: nothing will ever report that exit, and the action owes the owner the
 * one wake that says the process was lost.
 */
import type { TriggerKind } from '../contracts'

export const processExitKind: TriggerKind = {
  id: 'process-exit',
  clock: 'event',
  onRestart: 'end',
  firstDue: () => null,
  nextDue: () => null,
  onGated: 'hold',
  backsOff: false,
}

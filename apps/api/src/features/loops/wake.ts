/**
 * The words one loop fire delivers, and the tools it may not call.
 *
 *   - fixed, session target: the task verbatim, with the run's usual tools. Disabling `loops` here
 *     changed the tool roster on every fire, so the cached prefix was rewritten, and the drain
 *     unions a coalesced band's disabled tools, so a message sent beside the fire lost `loops`
 *     too. Nothing needed the guard: `reschedule` refuses a fixed loop and `add` is idempotent.
 *   - dynamic: a fire marker + the task; `loops` stays available, because pacing IS the agent's job.
 *     The marker names both ways forward. Not rescheduling no longer ends the loop — a fire arms a
 *     watchdog at the last delay (`triggers/kinds/delay`) — so a loop that is done is REMOVED, and
 *     the words have to say so or the agent would believe silence stops it.
 *   - subsession target: the previous round's handoff, then the task, in a fresh child that manages
 *     no loops (`Loops` disabled). The transcript is deliberately not carried: piping it in would
 *     reintroduce the growth the subsession target exists to avoid.
 */
import type { SessionLoop } from './contracts'
import { renderInheritedHandoff } from './handoff'

export function buildLoopWake(loop: SessionLoop): {
  content: string
  extraDisabledTools: string[]
} {
  if (loop.target === 'subsession') {
    const inherited = loop.handoff
      ? `${renderInheritedHandoff(loop.handoff, Math.max(1, loop.runCount))}\n\n`
      : ''
    return { content: `${inherited}${loop.prompt}`, extraDisabledTools: ['Loops'] }
  }
  if (loop.kind === 'dynamic') {
    const content =
      `Loop \`${loop.id}\` fired (self-pacing). Do this now, then set the next run with the loops ` +
      `tool, action="reschedule" — or action="remove" if the loop is no longer useful. Without ` +
      `either it fires again after the same delay:\n\n${loop.prompt}`
    return { content, extraDisabledTools: [] }
  }
  return { content: loop.prompt, extraDisabledTools: [] }
}

// How the `Loops` tool prints a loop: one line in a list, or every field for `get`.

import { loopClockTime, loopLastStatusLabel } from '../../loops/format'
import type { SessionLoop } from '../../loops/contracts'
import { plural } from '../../../lib/plural'

function cadence(l: SessionLoop): string {
  if (l.kind === 'dynamic')
    return l.delaySeconds ? `dynamic · ~${Math.round(l.delaySeconds / 60)}m` : 'dynamic'
  return `\`${l.cron}\``
}

export const shortTime = (iso: string): string => loopClockTime(iso)

function statsLine(l: SessionLoop): string {
  if (l.runCount === 0) return 'not fired yet'
  const last = l.lastRunAt ? shortTime(l.lastRunAt) : '?'
  // "delivered" vs "completed" is not cosmetic: for a session loop the recorded status only says
  // the wake was ENQUEUED, so printing a bare "ok" told the agent the run had gone fine.
  const status =
    l.lastStatus === 'error'
      ? `error${l.lastError ? ` (${l.lastError.slice(0, 120)})` : ''}`
      : loopLastStatusLabel(l)
  return `${plural(l.runCount, 'run')} · last ${last} → ${status}`
}

export function formatJob(l: SessionLoop): string {
  const next = shortTime(l.nextRunAt)
  const target = l.target === 'subsession' ? ' · subsession' : ''
  return `- **${l.id}** · ${cadence(l)}${target} · next: ${next} · ${statsLine(l)}\n  > ${l.prompt.slice(0, 100)}`
}

export function formatJobDetail(l: SessionLoop): string {
  const next = shortTime(l.nextRunAt)
  return [
    `**${l.id}**`,
    `- kind: ${l.kind} · cadence: ${cadence(l)} · target: ${l.target}`,
    `- next: ${next} · created: ${shortTime(l.createdAt)}`,
    `- stats: ${statsLine(l)}`,
    `- prompt:\n  > ${l.prompt}`,
  ].join('\n')
}

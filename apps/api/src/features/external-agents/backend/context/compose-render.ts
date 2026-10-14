import type { ComposeSection } from './compose-types'

export function hasOverlap(sections: readonly ComposeSection[]): boolean {
  const ranges = sections
    .filter((s) => s.earliest !== undefined && s.latest !== undefined)
    .map((s) => [s.earliest as number, s.latest as number] as const)
    .sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i][0] <= ranges[i - 1][1]) return true
  }
  return false
}

function iso(ms: number | undefined): string {
  return ms === undefined ? 'unknown' : new Date(ms).toISOString()
}

/**
 * WHICH events a section holds, not merely how many.
 *
 * Measured on a real local history: pulling context for the five largest sessions delivered 175 of 23,147
 * events — 0.76%. At that ratio the window IS the answer, and "49 shown of 8596" describes it no
 * better than silence does. Derived from the payload's own ordinals rather than from the caller's
 * `tail` request, so it stays true when the character budget lands the window at neither end.
 */
function windowOf(section: ComposeSection): string {
  /**
   * A capped source cannot support POSITIONS — its own `total` counts only what fitted, so a position
   * within the window is not a position within the session. It can support the END, and that is the
   * useful half: a tail read of an oversized file reads backwards and really does finish where the
   * session finishes, a head read really does start where it starts. Saying neither, which this did
   * for a day, is as wrong as naming the wrong one.
   */
  if (section.sourceTruncated) {
    const count = section.events.length
    if (count === 0) return ''
    const end = section.readFrom === 'tail' ? 'the latest' : 'the opening'
    return ` (${count} — ${end}, from a source too large to read whole)`
  }
  const ordinals = section.events.map((event) => event.ordinal)
  if (ordinals.length === 0 || ordinals.some((ordinal) => ordinal === undefined)) return ''
  const positions = ordinals as readonly number[]
  const first = Math.min(...positions) + 1
  const last = Math.max(...positions) + 1
  // The whole session is present; there is no window to name.
  if (first === 1 && last === section.totalEvents) return ''
  const end = first === 1 ? ' — the opening' : last === section.totalEvents ? ' — the latest' : ''
  return ` (positions ${first}–${last}${end})`
}

export function render(sections: readonly ComposeSection[], notes: readonly string[]): string {
  const out: string[] = ['# External agent sessions', '']
  for (const note of notes) out.push(`> ${note}`, '')
  for (const section of sections) {
    out.push(`## ${section.provider} — ${section.title}`)
    out.push(`- key: \`${section.key}\``)
    if (section.cwd) out.push(`- cwd: \`${section.cwd}\``)
    out.push(`- source: \`${section.sourcePath}\``)
    out.push(`- time range: ${iso(section.earliest)} → ${iso(section.latest)}`)
    out.push(
      `- events: ${section.events.length} of ${section.totalEvents}${windowOf(section)}${
        section.withheldEvents > 0 ? `, ${section.withheldEvents} withheld` : ''
      }`,
    )
    out.push('')
    for (const event of section.events) out.push(`**${event.role}**: ${event.text}`, '')
  }
  return out.join('\n')
}

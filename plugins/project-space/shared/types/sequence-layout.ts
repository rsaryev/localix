import type { SequenceContent } from './sequence-text'

/**
 * Where everything of a sequence diagram goes — one answer, read by the view that draws it and by
 * `measure`, which sizes the element, so the element is always exactly as large as what it draws.
 *
 * Participants stand in columns under the card's header, their heads repeated at the foot (as
 * Mermaid does) so a long diagram still names its lifelines; each message is one row, time
 * running down. Columns are as far apart as their labels need: every gap starts at the minimum,
 * then each message widens the gaps it spans until its label fits (narrow spans first, so one
 * long label is not spread over gaps a shorter one already widened). A fixed column let a long
 * label between neighbours run through both heads.
 *
 * Text is measured by estimate — a character of the label font is about `char` pixels — because
 * the layout also runs on the server, where there is no font to measure with.
 */
export const SEQUENCE = {
  /** The card's title row (`ui/elements/CardTitle.tsx` draws it at this height). */
  header: 32,
  pad: 20,
  head: { min: 120, max: 220, h: 36 },
  /** The least space between two heads. */
  space: 36,
  gap: 16,
  row: 42,
  tail: 14,
  selfLoop: 28,
  char: { head: 7, label: 6.2 },
} as const

export interface SequenceLayout {
  width: number
  height: number
  /** The head row's top; `foot` is the repeated heads' top. */
  top: number
  foot: number
  headWidth: number
  columns: Map<string, number>
  rowY(index: number): number
}

export function layoutSequence(content: SequenceContent): SequenceLayout {
  const { pad, head, space, gap, row, tail, header, selfLoop, char } = SEQUENCE
  const ids = content.participants.map((participant) => participant.id)
  const index = new Map(ids.map((id, at) => [id, at]))
  const headWidth = Math.min(
    head.max,
    Math.max(
      head.min,
      ...content.participants.map(
        (participant) => (participant.label ?? participant.id).length * char.head + 40,
      ),
    ),
  )
  const labelWidth = (text: string) => text.length * char.label + 28

  // gaps[i] is the distance between the centres of participant i and i + 1.
  const gaps = ids.slice(1).map(() => headWidth + space)
  const spans = content.messages
    .map((message) => ({
      from: index.get(message.from) ?? 0,
      to: index.get(message.to) ?? 0,
      need: labelWidth(message.text),
    }))
    .sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from))
  let right = headWidth / 2
  for (const { from, to, need } of spans) {
    if (from === to) {
      // A message to itself draws its loop and label to the right of its lifeline.
      const room = selfLoop + need
      if (from < gaps.length) gaps[from] = Math.max(gaps[from] as number, room + headWidth / 2)
      else right = Math.max(right, room)
      continue
    }
    const [low, high] = from < to ? [from, to] : [to, from]
    const have = gaps.slice(low, high).reduce((sum, value) => sum + value, 0)
    if (have >= need) continue
    const add = (need - have) / (high - low)
    for (let at = low; at < high; at++) gaps[at] = (gaps[at] as number) + add
  }

  const columns = new Map<string, number>()
  let x = pad + headWidth / 2
  ids.forEach((id, at) => {
    columns.set(id, Math.round(x))
    x += gaps[at] ?? 0
  })
  // The walk ends ON the last participant's centre (it has no gap after it).
  const last = columns.get(ids.at(-1) ?? '') ?? pad + headWidth / 2
  const top = header + pad
  const firstRow = top + head.h + gap
  const foot = firstRow + Math.max(1, content.messages.length) * row + tail
  return {
    width: Math.round(last + right + pad),
    height: foot + head.h + pad,
    top,
    foot,
    headWidth,
    columns,
    rowY: (message) => firstRow + message * row + row / 2,
  }
}

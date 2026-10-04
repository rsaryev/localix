import type { AgentItem } from '@localixai/agent/agents'
import type { Message } from '../model/types'

export type InlineSegment =
  | { kind: 'body'; items?: AgentItem[]; content?: string }
  | { kind: 'notice'; message: Message }

type Boundary = { index: number; offset: number; notice: Message; order: number }
type Position = Pick<Boundary, 'index' | 'offset'>

function hasText(item: AgentItem): item is Extract<AgentItem, { type: 'text' | 'reasoning' }> {
  return item.type === 'text' || item.type === 'reasoning'
}

function between(items: AgentItem[], start: Position, end: Position): AgentItem[] {
  const result: AgentItem[] = []
  for (let index = start.index; index <= end.index && index < items.length; index += 1) {
    const item = items[index]!
    if (hasText(item)) {
      const from = index === start.index ? start.offset : 0
      const to = index === end.index ? end.offset : item.text.length
      if (to <= from) continue
      result.push(
        from === 0 && to === item.text.length
          ? item
          : { ...item, id: `${item.id}:inline:${from}`, text: item.text.slice(from, to) },
      )
    } else if (index < end.index) {
      result.push(item)
    }
  }
  return result
}

/** Divide the visible body at the boundaries captured when notices arrived.
 * This does not mutate the stored assistant message or its model-facing items. */
export function inlineNoticeSegments(message: Message): InlineSegment[] {
  const notices = message.inlineNotices ?? []
  if (!notices.length) return [{ kind: 'body', items: message.items, content: message.content }]
  const items = message.items ?? []
  if (!items.length) {
    const content = message.content ?? ''
    const boundaries = notices
      .map((notice, order) => ({
        notice,
        order,
        offset: Math.min(content.length, Math.max(0, notice.withinMessage?.contentOffset ?? 0)),
      }))
      .sort((a, b) => a.offset - b.offset || a.order - b.order)
    const segments: InlineSegment[] = []
    let offset = 0
    for (const boundary of boundaries) {
      if (boundary.offset > offset) {
        segments.push({ kind: 'body', content: content.slice(offset, boundary.offset) })
      }
      segments.push({ kind: 'notice', message: boundary.notice })
      offset = boundary.offset
    }
    if (offset < content.length) segments.push({ kind: 'body', content: content.slice(offset) })
    return segments
  }

  const boundaries: Boundary[] = notices
    .map((notice, order) => {
      const itemIndex = items.findIndex((item) => item.id === notice.withinMessage?.itemId)
      if (itemIndex < 0) {
        return {
          index: notice.withinMessage?.itemId ? items.length : 0,
          offset: 0,
          notice,
          order,
        }
      }
      const item = items[itemIndex]!
      if (!hasText(item)) return { index: itemIndex + 1, offset: 0, notice, order }
      const offset = Math.min(
        item.text.length,
        Math.max(0, notice.withinMessage?.textOffset ?? item.text.length),
      )
      return offset === item.text.length
        ? { index: itemIndex + 1, offset: 0, notice, order }
        : { index: itemIndex, offset, notice, order }
    })
    .sort((a, b) => a.index - b.index || a.offset - b.offset || a.order - b.order)

  const segments: InlineSegment[] = []
  let start: Position = { index: 0, offset: 0 }
  for (const boundary of boundaries) {
    const portion = between(items, start, boundary)
    if (portion.length) segments.push({ kind: 'body', items: portion })
    segments.push({ kind: 'notice', message: boundary.notice })
    start = boundary
  }
  const remainder = between(items, start, { index: items.length, offset: 0 })
  if (remainder.length) segments.push({ kind: 'body', items: remainder })
  return segments
}

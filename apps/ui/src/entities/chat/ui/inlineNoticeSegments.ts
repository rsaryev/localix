import type { AgentItem } from '@localixai/agent/agents'
import type { Message } from '../model/types'
import {
  coalesceSystemMessages,
  isSystemActivity,
  needsSystemMessageAttention,
} from './coalesceSystemMessages'

export type InlineSegment =
  | { kind: 'body'; items?: AgentItem[]; content?: string; activity?: Message[] }
  | { kind: 'notice'; message: Message }
  | { kind: 'pending'; messages: Message[] }

/** Arrival anchors select explicit agent-item boundaries, never character offsets.
 * Ordinary notices wait for a growing narrative item to close; important notices
 * remain visible immediately. All state is derived from the current bounded
 * transcript: no timers, subscriptions, retained queues or Markdown heuristics. */
export function inlineNoticeSegments(message: Message, isStreaming = false): InlineSegment[] {
  const notices = message.inlineNotices ?? []
  const items = message.items ?? []
  if (!notices.length) return [{ kind: 'body', items: message.items, content: message.content }]

  const end = items.length || 1
  const indices = new Map(items.map((item, index) => [item.id, index]))
  const boundaries = notices
    .map((notice, order) => {
      const itemId = notice.withinMessage?.itemId
      const itemIndex = itemId ? indices.get(itemId) : undefined
      const beforeBody = !itemId && notice.withinMessage?.contentOffset === 0
      const index = itemIndex === undefined ? (beforeBody ? 0 : end) : itemIndex + 1
      const item = itemIndex === undefined ? undefined : items[itemIndex]
      const growing =
        isStreaming &&
        !beforeBody &&
        (items.length === 0 ||
          (itemIndex === items.length - 1 &&
            (item?.type === 'text' || item?.type === 'reasoning') &&
            item.status === 'running'))
      return { index, notice, order, pending: growing && !needsSystemMessageAttention(notice) }
    })
    .sort((a, b) => a.index - b.index || a.order - b.order)

  const segments: InlineSegment[] = []
  const pending: Message[] = []
  let start = 0
  let activity: Message[] = []
  const groupedBoundaries: typeof boundaries = []
  for (let index = 0; index < boundaries.length;) {
    const first = boundaries[index]!
    let runEnd = index + 1
    while (runEnd < boundaries.length && boundaries[runEnd]!.index === first.index) runEnd += 1
    const run = boundaries.slice(index, runEnd)
    const originals = new Map(run.map((boundary) => [boundary.notice.id, boundary]))
    for (const notice of coalesceSystemMessages(run.map((boundary) => boundary.notice))) {
      groupedBoundaries.push({ ...originals.get(notice.id)!, notice })
    }
    index = runEnd
  }
  for (const boundary of groupedBoundaries) {
    if (isSystemActivity(boundary.notice)) {
      activity.push(boundary.notice)
      continue
    }
    if (boundary.index > start) {
      segments.push(
        items.length
          ? {
              kind: 'body',
              items: items.slice(start, boundary.index),
              ...(activity.length ? { activity } : {}),
            }
          : { kind: 'body', content: message.content, ...(activity.length ? { activity } : {}) },
      )
      activity = []
    } else if (activity.length) {
      segments.push({ kind: 'body', items: [], activity })
      activity = []
    }
    if (boundary.pending) pending.push(boundary.notice)
    else segments.push({ kind: 'notice', message: boundary.notice })
    start = boundary.index
  }
  if (start < end) {
    segments.push(
      items.length
        ? { kind: 'body', items: items.slice(start), ...(activity.length ? { activity } : {}) }
        : { kind: 'body', content: message.content, ...(activity.length ? { activity } : {}) },
    )
    activity = []
  }
  if (activity.length) segments.push({ kind: 'body', items: [], activity })
  if (pending.length) segments.push({ kind: 'pending', messages: pending })
  return segments
}

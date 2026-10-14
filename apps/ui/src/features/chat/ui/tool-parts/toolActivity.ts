import type { AgentItem } from '@localixai/agent/agents'
import type { Message } from '../../model/types'
import { isToolBacked } from './itemHelpers'

/** Route routine events to the nearest preceding action in their assistant segment. */
export function activityByTool(items: readonly AgentItem[], activity: readonly Message[]) {
  const indices = new Map(items.map((item, index) => [item.id, index]))
  const byTool = new Map<string, Message[]>()
  const beforeTool = new Map<string, Message[]>()
  const remaining: Message[] = []
  for (const message of activity) {
    const position = message.withinMessage
    const boundary = position?.itemId
      ? (indices.get(position.itemId) ?? items.length - 1)
      : position?.contentOffset === 0
        ? -1
        : items.length - 1
    let index = boundary
    while (index >= 0 && !isToolBacked(items[index]!)) index -= 1
    const tool = items[index]
    const following = !tool ? items.slice(boundary + 1).find(isToolBacked) : undefined
    const owner = tool ?? following
    if (!owner) remaining.push(message)
    else {
      const target = tool ? byTool : beforeTool
      const notices = target.get(owner.id) ?? []
      notices.push(message)
      target.set(owner.id, notices)
    }
  }
  return { byTool, beforeTool, remaining }
}

export type ToolActivitySegment =
  | { kind: 'items'; items: AgentItem[] }
  | { kind: 'activity'; messages: Message[] }

/** The expanded action block preserves calls and events in their captured causal order. */
export function toolActivitySegments(
  items: readonly AgentItem[],
  activity: readonly Message[],
): ToolActivitySegment[] {
  const { byTool, beforeTool, remaining } = activityByTool(items, activity)
  const segments: ToolActivitySegment[] = []
  let run: AgentItem[] = []
  for (const item of items) {
    const preceding = beforeTool.get(item.id)
    if (preceding?.length) {
      if (run.length) segments.push({ kind: 'items', items: run })
      segments.push({ kind: 'activity', messages: preceding })
      run = []
    }
    run.push(item)
    const messages = byTool.get(item.id)
    if (messages?.length) {
      segments.push({ kind: 'items', items: run }, { kind: 'activity', messages })
      run = []
    }
  }
  if (run.length) segments.push({ kind: 'items', items: run })
  if (remaining.length) segments.push({ kind: 'activity', messages: remaining })
  return segments
}

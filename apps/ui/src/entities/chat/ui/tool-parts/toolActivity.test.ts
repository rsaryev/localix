import { expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'
import type { Message } from '../../model/types'
import { activityByTool, toolActivitySegments } from './toolActivity'

const tool = (id: string): AgentItem => ({
  id,
  type: 'tool_call',
  status: 'completed',
  toolCallId: id,
  name: 'bash',
  activeVerb: 'Running',
})
const event = (id: string, itemId?: string): Message => ({
  id,
  role: 'system',
  withinMessage: itemId ? { itemId } : undefined,
  systemNotice: {
    kind: 'terminal_activity',
    tone: 'neutral',
    text: id,
    activity: { id: 'pty', state: 'completed' },
  },
})

test('expanded actions keep events after their captured tool and preserve alternating messages', () => {
  const items = [tool('first'), tool('second')]
  const activity = [event('A', 'first'), event('B', 'first'), event('A-again', 'second')]
  expect(toolActivitySegments(items, activity)).toEqual([
    { kind: 'items', items: [items[0]] },
    { kind: 'activity', messages: activity.slice(0, 2) },
    { kind: 'items', items: [items[1]] },
    { kind: 'activity', messages: [activity[2]] },
  ])
})

test('narrative anchors attach to the preceding action and unknown anchors remain available', () => {
  const items: AgentItem[] = [
    tool('first'),
    { id: 'text', type: 'text', status: 'completed', text: 'Explaining' },
  ]
  const activity = [event('after-text', 'text'), event('missing', 'gone')]
  expect(activityByTool(items, activity).byTool.get('first')).toEqual(activity)
  expect(toolActivitySegments([], activity)).toEqual([{ kind: 'activity', messages: activity }])
})

test('events captured before the first action stay before it inside the same disclosure', () => {
  const text: AgentItem = { id: 'text', type: 'text', status: 'completed', text: 'Starting' }
  const items = [text, tool('first')]
  const before = { ...event('before'), withinMessage: { contentOffset: 0 } }
  const afterText = event('after-text', 'text')
  expect(activityByTool(items, [before, afterText]).beforeTool.get('first')).toEqual([
    before,
    afterText,
  ])
  expect(toolActivitySegments([items[1]!], [before])).toEqual([
    { kind: 'activity', messages: [before] },
    { kind: 'items', items: [items[1]] },
  ])
})

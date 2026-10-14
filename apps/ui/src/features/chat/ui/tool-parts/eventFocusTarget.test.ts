import { describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'
import type { EventFocusRequest } from '@/shared/lib/eventFocusBus'
import { eventFocusTargetsAnyTool, eventFocusTargetsTool } from './eventFocusTarget'

const request: EventFocusRequest = {
  token: 1,
  sessionId: 'LOCALIX-18',
  projectId: 'project-1',
  resourceKind: 'tool',
  resourceId: 'call-7',
}
const item = {
  id: 'tool-1',
  type: 'tool_call',
  name: 'bash',
  toolCallId: 'call-7:invoke',
} as AgentItem

describe('event focus tool targeting', () => {
  test('matches exact and prefixed tool/interaction resources in the destination session', () => {
    expect(eventFocusTargetsTool(request, 'LOCALIX-18', item)).toBe(true)
    expect(
      eventFocusTargetsTool({ ...request, resourceKind: 'interaction' }, 'LOCALIX-18', item),
    ).toBe(true)
  })

  test('never leaks a reveal into a warm transcript from another session', () => {
    expect(eventFocusTargetsTool(request, 'LOCALIX-17', item)).toBe(false)
    expect(
      eventFocusTargetsTool({ ...request, resourceKind: 'terminal' }, 'LOCALIX-18', item),
    ).toBe(false)
    expect(eventFocusTargetsAnyTool(request, 'LOCALIX-18', [item])).toBe(true)
  })
})

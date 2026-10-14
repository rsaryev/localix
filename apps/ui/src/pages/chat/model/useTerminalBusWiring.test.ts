import { describe, expect, it } from 'bun:test'
import { terminalEventFocusTarget } from './useTerminalBusWiring'
import type { EventFocusRequest } from '@/shared/lib/eventFocusBus'

const request: EventFocusRequest = {
  token: 1,
  sessionId: 'LOCALIX-18',
  projectId: 'project-1',
  resourceKind: 'terminal',
  resourceId: 'pty-42',
}

describe('terminal event focus', () => {
  it('claims an exact terminal resource only after its session is active', () => {
    expect(terminalEventFocusTarget(request, 'LOCALIX-17')).toBeNull()
    expect(terminalEventFocusTarget(request, 'LOCALIX-18')).toEqual({
      terminalId: 'pty-42',
      sessionId: 'LOCALIX-18',
    })
  })

  it('leaves feature-foreign resources for their owner', () => {
    expect(terminalEventFocusTarget({ ...request, resourceKind: 'tool' }, 'LOCALIX-18')).toBeNull()
  })
})

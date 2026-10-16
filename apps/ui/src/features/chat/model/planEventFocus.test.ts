import { describe, expect, test } from 'bun:test'

import type { EventFocusRequest } from '@/shared/lib/eventFocusBus'
import { planEventFocusTarget } from './planEventFocus'

const request = (over: Partial<EventFocusRequest> = {}): EventFocusRequest => ({
  token: 1,
  sessionId: 's1',
  projectId: 'p1',
  resourceKind: 'plan',
  resourceId: 'plan-2',
  ...over,
})

describe('the Event Center deep link to a plan', () => {
  test('opens the named plan once its chat is the one on screen', () => {
    expect(planEventFocusTarget(request(), 's1')).toEqual({ sessionId: 's1', planId: 'plan-2' })
  })

  test('waits while another chat is shown, and leaves other kinds to their owners', () => {
    expect(planEventFocusTarget(request(), 's2')).toBeNull()
    expect(planEventFocusTarget(request({ resourceKind: 'terminal' }), 's1')).toBeNull()
    expect(planEventFocusTarget(null, 's1')).toBeNull()
  })
})

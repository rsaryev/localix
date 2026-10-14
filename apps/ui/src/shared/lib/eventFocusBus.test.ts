import { beforeEach, describe, expect, it } from 'bun:test'
import { requestEventFocus, useEventFocusStore } from './eventFocusBus'

beforeEach(() => useEventFocusStore.setState({ pending: null, active: null, sequence: 0 }))

describe('event focus handoff', () => {
  it('retains a typed resource request until its owner consumes it', () => {
    requestEventFocus({
      kind: 'resource',
      sessionId: 'LOCALIX-18',
      projectId: null,
      resourceKind: 'tool',
      resourceId: 'call-1',
    })
    const pending = useEventFocusStore.getState().pending
    expect(useEventFocusStore.getState().active).toBe(pending)
    expect(pending).toMatchObject({
      token: 1,
      sessionId: 'LOCALIX-18',
      resourceKind: 'tool',
      resourceId: 'call-1',
    })

    useEventFocusStore.getState().consume(999)
    expect(useEventFocusStore.getState().pending).toBe(pending)
    useEventFocusStore.getState().consume(1)
    expect(useEventFocusStore.getState().pending).toBeNull()
    expect(useEventFocusStore.getState().active).toBe(pending)
    useEventFocusStore.getState().clearActive(1)
    expect(useEventFocusStore.getState().active).toBeNull()
  })

  it('ignores origins that have no addressable resource', () => {
    requestEventFocus({ kind: 'application' })
    requestEventFocus({ kind: 'session', sessionId: 'LOCALIX-18', projectId: null })
    expect(useEventFocusStore.getState().pending).toBeNull()
  })
})

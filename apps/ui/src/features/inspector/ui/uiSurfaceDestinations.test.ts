import { describe, expect, test } from 'bun:test'
import quickOpen from './QuickOpen.surface'
import snapshot from './MessageReplayTab.surface'
import problems from './ProblemsTab.surface'

describe('addressable UI surface destinations', () => {
  test('keeps overlay contents opaque while forwarding validated seed arguments', () => {
    expect(quickOpen.effect).toBe('read')
    expect(quickOpen.resolve({ query: 'src/main' })).toEqual({
      kind: 'overlay',
      overlayId: 'quick-open',
      params: { query: 'src/main' },
    })
  })

  test('addresses a snapshot by its owning message without exposing message contents', () => {
    expect(snapshot.effect).toBe('read')
    expect(snapshot.resolve({ session: 'session-1', message: 'message-2' })).toEqual({
      kind: 'inspector',
      target: 'message-replay',
      sessionId: 'session-1',
      messageId: 'message-2',
    })
  })

  test('opens read-only app views through the generic work-item target', () => {
    expect(problems.resolve({})).toEqual({
      kind: 'work-item',
      workKind: 'problems',
      id: 'problems',
      title: 'Problems',
    })
  })
})

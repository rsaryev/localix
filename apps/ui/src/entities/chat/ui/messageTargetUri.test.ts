import { describe, expect, test } from 'bun:test'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'

import { eventFocusMessageId, messageTargetUri, visibleEventFocusRequest } from './messageTargetUri'
import type { Message } from '../model/types'

/**
 * A row's addressable URI, and the reason its old fallback was a latent crash.
 *
 * `sessionId` is nullable here and every other use in that file guards it. The render path used
 * `sessionId ?? ''` — silencing the type checker with a value the runtime rejects. The only net
 * around it was the ROOT error boundary, which is the same shape that took the entire workspace
 * down when a mini app built a `localix://` URI from an empty id during render.
 */
describe('messageTargetUri', () => {
  test('addresses a message that has a session', () => {
    expect(messageTargetUri('LOCALIX-9', 'm1')).toBe('localix://resource/chat/message/LOCALIX-9/m1')
  })

  test('returns undefined rather than an unaddressable URI', () => {
    // `useUiTarget` accepts undefined and registers nothing, so this is the truthful answer:
    // a message with no session is not addressable.
    expect(messageTargetUri(null, 'm1')).toBeUndefined()
    expect(messageTargetUri('', 'm1')).toBeUndefined()
    expect(messageTargetUri('LOCALIX-9', '')).toBeUndefined()
  })

  test('the old fallback really did throw — this is why the guard exists', () => {
    // Pinning the reason, not just the fix. If the builder ever stopped throwing on an empty
    // segment, the guard above would look like defensive noise and get removed.
    expect(() => localixResourceUri('chat', ['message', '', 'm1'])).toThrow()
  })
})

describe('eventFocusMessageId', () => {
  const messages = [
    { id: 'assistant-1', items: [{ type: 'tool_call', toolCallId: 'call-123', name: 'Bash' }] },
    { id: 'assistant-2', items: [] },
  ] as unknown as Message[]
  const request = {
    token: 1,
    sessionId: 'LOCALIX-9',
    projectId: null,
    resourceKind: 'tool',
    resourceId: 'call-123',
  }

  test('maps tool and interaction resources to their transcript message', () => {
    expect(eventFocusMessageId(messages, request)).toBe('assistant-1')
    expect(eventFocusMessageId(messages, { ...request, resourceKind: 'interaction' })).toBe(
      'assistant-1',
    )
  })

  test('maps run ids directly and leaves feature-foreign resources pending', () => {
    expect(
      eventFocusMessageId(messages, {
        ...request,
        resourceKind: 'run',
        resourceId: 'assistant-2',
      }),
    ).toBe('assistant-2')
    expect(eventFocusMessageId(messages, { ...request, resourceKind: 'terminal' })).toBeNull()
  })

  test('lets only the visible destination transcript claim a cross-session reveal', () => {
    expect(visibleEventFocusRequest(request, 'LOCALIX-9', false)).toBeNull()
    expect(visibleEventFocusRequest(request, 'LOCALIX-8', true)).toBeNull()
    expect(visibleEventFocusRequest(request, 'LOCALIX-9', true)).toBe(request)
  })
})

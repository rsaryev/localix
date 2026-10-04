import { describe, expect, test } from 'bun:test'

import { buildMessageDigest, MESSAGE_DIGEST_MAX_CHARS } from './message-digest'

describe('buildMessageDigest', () => {
  test('renders the role + text, tagged with the host session id', () => {
    const out = buildMessageDigest({
      sessionId: 'LOCALIX-7',
      messageId: 'm1',
      role: 'user',
      text: 'how do I ship this?',
    })
    expect(out).toContain('Message from session LOCALIX-7 (user):')
    expect(out).toContain('how do I ship this?')
  })

  test('truncates a long body with a marker', () => {
    const long = 'x'.repeat(MESSAGE_DIGEST_MAX_CHARS + 500)
    const out = buildMessageDigest({
      sessionId: 's',
      messageId: 'm',
      role: 'assistant',
      text: long,
    })
    expect(out).toContain('[…truncated…]')
    expect(out.length).toBeLessThan(long.length)
  })

  test('an empty message is a clear note', () => {
    const out = buildMessageDigest({
      sessionId: 's',
      messageId: 'm',
      role: 'assistant',
      text: '   ',
    })
    expect(out).toContain('(empty message)')
  })
})

import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { sessionPreview } from './sessionPreview'

const route = (handle: string) => ({
  agentId: `fixture:${handle}`,
  handle,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'low' as const,
})

function session(overrides: Partial<UiSession> = {}): UiSession {
  return {
    agents: [route('localix')],
    isRunning: false,
    ...overrides,
  } as UiSession
}

describe('sessionPreview', () => {
  test('a live run does not take this slot', () => {
    // It is a leading mark on the title line instead: in this slot it read as something the
    // agent had said, and it cost the row a second line that rows without one did not have.
    const preview = sessionPreview(
      session({ isRunning: true, lastMessage: { from: 'user', text: 'older', at: 0 } }),
    )
    expect(preview).toMatchObject({ kind: 'message', text: 'older' })
  })

  test("a private chat does not repeat its one agent's name", () => {
    // There is only one voice it could be; printing it on every row is noise.
    const preview = sessionPreview(
      session({ lastMessage: { from: 'agent:localix', text: 'done', at: 0 } }),
    )
    expect(preview).toEqual({ kind: 'message', text: 'done' })
  })

  test('the user is always named — "You:" is the signal nobody has answered', () => {
    const preview = sessionPreview(session({ lastMessage: { from: 'user', text: 'ping', at: 0 } }))
    expect(preview).toMatchObject({ author: 'You', text: 'ping' })
    expect(preview.authorHandle).toBeUndefined()
  })

  test('a party of two names everyone, and carries the handle for its colour', () => {
    const preview = sessionPreview(
      session({
        agents: [route('localix'), route('reviewer')],
        lastMessage: { from: 'agent:reviewer', text: 'looks wrong', at: 0 },
      }),
    )
    expect(preview).toEqual({
      kind: 'message',
      text: 'looks wrong',
      author: '@reviewer',
      authorHandle: 'reviewer',
    })
  })

  test('nothing said yet is empty, not a blank line', () => {
    expect(sessionPreview(session()).kind).toBe('empty')
    expect(sessionPreview(session({ lastMessage: { from: 'user', text: '', at: 0 } })).kind).toBe(
      'empty',
    )
  })

  test('the application speaking is not attributed to an agent', () => {
    const preview = sessionPreview(
      session({
        agents: [route('localix'), route('reviewer')],
        lastMessage: { from: 'system', text: 'Run interrupted', at: 0 },
      }),
    )
    expect(preview.author).toBeUndefined()
    expect(preview.text).toBe('Run interrupted')
  })
})

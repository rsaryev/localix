import { describe, expect, test } from 'bun:test'
import { handleApiWorkspaceCommand, subscribeApiWorkspaceCommands } from './collectionEvents'

describe('agent collection change routing', () => {
  test('delivers every chat’s commands with the chat that issued them', () => {
    // A background chat's workspace is still that chat's: dropping its agent's commands because
    // another chat is on screen left its list stale until the slow poll.
    const seen: unknown[] = []
    const unsubscribe = subscribeApiWorkspaceCommands((command, sessionId) =>
      seen.push({ command, sessionId }),
    )
    try {
      for (const [seq, [sessionId, active]] of (
        [
          ['s', true],
          ['other', false],
        ] as const
      ).entries()) {
        handleApiWorkspaceCommand({
          active,
          sessionId,
          commandId: `c-${seq}`,
          seq,
          payload: { type: 'collection_changed', target: 'request', action: 'save' },
        })
      }
      const command = { type: 'collection_changed', target: 'request', action: 'save' }
      expect(seen).toEqual([
        { command, sessionId: 's' },
        { command, sessionId: 'other' },
      ])
    } finally {
      unsubscribe()
    }
  })

  test('ignores malformed commands', () => {
    const seen: unknown[] = []
    const unsubscribe = subscribeApiWorkspaceCommands((command) => seen.push(command))
    try {
      handleApiWorkspaceCommand({
        active: true,
        sessionId: 's',
        commandId: 'd',
        seq: 2,
        payload: { nope: true },
      })
      expect(seen).toEqual([])
    } finally {
      unsubscribe()
    }
  })

  test('delivers the agent request lifecycle', () => {
    const seen: unknown[] = []
    const unsubscribe = subscribeApiWorkspaceCommands((command) => seen.push(command))
    try {
      for (const [seq, phase] of ['started', 'completed'].entries()) {
        handleApiWorkspaceCommand({
          active: true,
          sessionId: 's',
          commandId: `send-${seq}`,
          seq,
          payload: { type: 'request_send', name: 'users/get', phase },
        })
      }
      expect(seen).toEqual([
        { type: 'request_send', name: 'users/get', phase: 'started' },
        { type: 'request_send', name: 'users/get', phase: 'completed' },
      ])
    } finally {
      unsubscribe()
    }
  })
})

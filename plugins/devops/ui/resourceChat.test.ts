import { describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'

import { composerBus, type ComposerInsert } from '@localixai/kit/testing'
import { linkDevOpsResourceToChat } from './resourceChat'

describe('DevOps resource link', () => {
  test('stages only the native binding and never invents user intent', () => {
    let insert: ComposerInsert | undefined
    const unsubscribe = composerBus.subscribe((request) => {
      insert = request
    })
    try {
      linkDevOpsResourceToChat('chat-a', {
        uri: 'localix://resource/docker/image/sha256%3Aabc',
        label: 'api:latest',
      })
    } finally {
      unsubscribe()
    }

    // Addressed to the surface's own chat, never to whichever composer has focus.
    expect(insert?.sessionId).toBe('chat-a')
    expect(insert?.text).toBeUndefined()
    expect(insert?.bindings).toEqual([
      {
        kind: 'context',
        source: 'plugin',
        target: {
          kind: 'resource',
          token: '@resource:localix://resource/docker/image/sha256%3Aabc',
          uri: 'localix://resource/docker/image/sha256%3Aabc',
          label: 'api:latest',
        },
      },
    ])
  })
})

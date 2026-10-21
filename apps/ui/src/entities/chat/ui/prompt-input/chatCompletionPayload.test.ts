import { describe, expect, test } from 'bun:test'
import type { CompletionReference } from '@localixai/api/client'
import { chatCompletionPayload } from './chatCompletionPayload'

describe('chatCompletionPayload', () => {
  test('carries the linked chips that ground Tab completion', () => {
    const references: CompletionReference[] = [
      {
        kind: 'file',
        token: '@file:src/settings.ts',
        label: 'settings.ts',
        attributes: { path: 'src/settings.ts' },
        origin: 'linked',
      },
      {
        kind: 'resource',
        token: '@resource:localix://resource/git/repo/status',
        label: 'status',
        uri: 'localix://resource/git/repo/status',
        origin: 'linked',
      },
    ]

    expect(chatCompletionPayload('Fix the', references)).toEqual({
      draft: 'Fix the',
      references,
    })
  })

  test('omits an empty context list instead of creating a second empty representation', () => {
    expect(chatCompletionPayload('Continue', [])).toEqual({ draft: 'Continue' })
  })
})

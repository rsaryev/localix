import { describe, expect, test } from 'bun:test'

import { createEditPredictionContextProvider } from './edit-prediction-context-provider'

describe('Edit Prediction host Context Fabric provider', () => {
  test('contributes only the active-document descriptor and its same-document history', async () => {
    const provider = createEditPredictionContextProvider()
    const contributions = await provider.provide(
      {
        destination: 'edit-prediction',
        userId: 'u',
        sessionId: 's',
        maxBytes: 10_000,
        document: {
          uri: '/workspace/a.ts',
          languageId: 'typescript',
          revision: 'doc-4',
          content: 'const a = 2',
        },
        editHistory: [
          { before: ['const a = 1'], lines: ['const a = 2'], startLine: 1, endLine: 1 },
        ],
      },
      new AbortController().signal,
    )

    expect(contributions).toHaveLength(2)
    expect(contributions[0]).toMatchObject({
      scope: 'document',
      kind: 'active-document',
      revision: 'doc-4',
    })
    expect(contributions[0]?.content).not.toContain('const a = 2')
    expect(contributions[1]).toMatchObject({ scope: 'session', kind: 'edit-history' })
    expect(contributions[1]?.content).toContain('-const a = 1')
    expect(contributions[1]?.content).toContain('+const a = 2')
  })

  test('does not emit context after cancellation or without an active document', () => {
    const provider = createEditPredictionContextProvider()
    const controller = new AbortController()
    controller.abort()
    expect(
      provider.provide(
        { destination: 'edit-prediction', userId: 'u', maxBytes: 1 },
        controller.signal,
      ),
    ).resolves.toEqual([])
  })
})

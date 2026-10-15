import { describe, expect, test } from 'bun:test'
import { toImportSessionRequest } from './sessions'

describe('toImportSessionRequest', () => {
  test('rebuilds the wire body field by field, dropping UI-only message keys', () => {
    const message = { role: 'user' as const, content: 'hi', id: 'local-1', optimistic: true }
    expect(toImportSessionRequest({ title: 't', messages: [message] })).toEqual({
      title: 't',
      messages: [{ role: 'user', content: 'hi' }],
    })
  })

  test('keeps an explicit null project and omits an absent one', () => {
    expect(toImportSessionRequest({ title: 't', messages: [], projectId: null })).toEqual({
      title: 't',
      projectId: null,
      messages: [],
    })
  })
})

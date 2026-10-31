import { describe, expect, test } from 'bun:test'
import { resolveSession, unknownSession, type SessionFacts } from './facts'

const known: SessionFacts = {
  id: 's1',
  projectId: 'p1',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'unknown-origin' },
}

describe('resolveSession', () => {
  test('is the session the lookup finds', async () => {
    expect(await resolveSession(async () => known, 'u1', 's1')).toBe(known)
  })

  test('names a session the lookup cannot find or fails to read', async () => {
    expect(await resolveSession(async () => null, 'u1', 's2')).toEqual(unknownSession('s2'))
    const failing = async () => {
      throw new Error('database closed')
    }
    expect(await resolveSession(failing, 'u1', 's3')).toEqual(unknownSession('s3'))
  })
})

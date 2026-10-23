import { describe, expect, test } from 'bun:test'

import { sessionResourceAddress } from './session-resource'

describe('sessionResourceAddress', () => {
  const board = sessionResourceAddress('acme', 'board')

  test('a chat’s resource round-trips whatever its session id holds', () => {
    expect(board.uri).toBe('localix://resource/acme/board')
    for (const session of ['LOCALIX-4', 'a/b', '50%', 'ü'])
      expect(board.sessionOf(board.forSession(session))).toBe(session)
    expect(board.sessionOf(board.uri)).toBeNull()
  })

  test('another provider, another resource, a deeper path or a query names nothing', () => {
    expect(board.sessionOf('localix://resource/other/board/s1')).toBeUndefined()
    expect(board.sessionOf('localix://resource/acme/clock/s1')).toBeUndefined()
    expect(board.sessionOf('localix://resource/acme/board/s1/extra')).toBeUndefined()
    expect(board.sessionOf('localix://resource/acme/board/s1?x=1')).toBeUndefined()
    // The hand-rolled prefix split this replaces accepted a dot segment as a session.
    expect(board.sessionOf('localix://resource/acme/board/..')).toBeUndefined()
  })
})

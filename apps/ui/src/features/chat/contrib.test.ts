import { describe, expect, test } from 'bun:test'
import { chatResourceAnchor } from './contrib'

describe('chat resource UI anchor', () => {
  test('maps canonical project, session, and message identities', () => {
    expect(chatResourceAnchor.resolve('localix://resource/chat/session/s1')).toEqual({
      kind: 'session',
      sessionId: 's1',
    })
    expect(chatResourceAnchor.resolve('localix://resource/chat/project/p1')).toEqual({
      kind: 'project',
      projectId: 'p1',
    })
    expect(
      chatResourceAnchor.resolve('localix://resource/chat/message/session%2Fone/message%2042'),
    ).toEqual({
      kind: 'message',
      sessionId: 'session/one',
      messageId: 'message 42',
    })
  })

  test('rejects other providers, malformed paths, and query-bearing identities', () => {
    for (const uri of [
      'localix://resource/fixture-db/session/s1',
      'localix://resource/chat/session',
      'localix://resource/chat/session/s1/extra',
      'localix://resource/chat/session/s1?unexpected=1',
      'chat://session/s1',
    ]) {
      expect(chatResourceAnchor.resolve(uri)).toBeNull()
    }
  })
})

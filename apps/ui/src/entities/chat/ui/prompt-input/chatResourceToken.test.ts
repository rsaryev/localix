import { describe, expect, it } from 'bun:test'
import { chatUriToNativeToken, isChatResourceUri } from './chatResourceToken'

describe('chatUriToNativeToken', () => {
  it('project uri → @project token', () => {
    expect(chatUriToNativeToken('localix://resource/chat/project/p1')).toBe('@project:p1')
  })
  it('session uri → @session token', () => {
    expect(chatUriToNativeToken('localix://resource/chat/session/LOCALIX-42')).toBe(
      '@session:LOCALIX-42',
    )
  })
  it('message uri → @message token (keeps the session/message pair)', () => {
    expect(chatUriToNativeToken('localix://resource/chat/message/LOCALIX-42/msg-abc')).toBe(
      '@message:LOCALIX-42/msg-abc',
    )
  })
  it('non-chat uri → null (falls back to @resource:)', () => {
    expect(chatUriToNativeToken('localix://resource/fixture-db/c1/_/public/orders')).toBeNull()
    expect(chatUriToNativeToken('localix://resource/git/p1/branches/main')).toBeNull()
  })
  it('malformed / partial chat uri → null', () => {
    expect(chatUriToNativeToken('localix://resource/chat/project')).toBeNull()
    expect(chatUriToNativeToken('localix://resource/chat/project/p1/extra')).toBeNull()
    expect(chatUriToNativeToken('localix://resource/chat/bogus/x')).toBeNull()
    expect(chatUriToNativeToken('localix://resource/chat/message/only-session')).toBeNull()
  })
  it('isChatResourceUri guards the scheme', () => {
    expect(isChatResourceUri('localix://resource/chat/project/p1')).toBe(true)
    expect(isChatResourceUri('localix://resource/fixture-db/c1')).toBe(false)
  })
})

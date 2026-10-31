import { describe, expect, test } from 'bun:test'
import type { MiniAppHostRefs } from './mini-app-host-refs'
import { workspaceCapabilities } from './mini-app-workspace-capabilities'

/** A chat service holding only what the session half reads. */
const chatWith = (resolveSessionCwd: (userId: string, sessionId: string) => Promise<string>) =>
  ({ resolveSessionCwd }) as unknown as MiniAppHostRefs['chatService']

describe('workspaceCapabilities — the session half', () => {
  test('answers null before the chat service exists, then the session’s folder', async () => {
    const refs: MiniAppHostRefs = {}
    const { workspaceScope, workspaces } = workspaceCapabilities(refs)
    expect(await workspaceScope!.resolveSessionRoot('u1', 's1')).toBeNull()
    expect(await workspaces!.resolveSessionDirectory!('u1', 's1')).toBeNull()

    refs.chatService = chatWith(async (userId, sessionId) => `/work/${userId}/${sessionId}`)
    expect(await workspaceScope!.resolveSessionRoot('u1', 's1')).toBe('/work/u1/s1')
    expect(await workspaces!.resolveSessionDirectory!('u1', 's1')).toBe('/work/u1/s1')
  })

  test('a session the chat service cannot resolve reads as no folder', async () => {
    const { workspaceScope, workspaces } = workspaceCapabilities({
      chatService: chatWith(async () => {
        throw new Error('session not found')
      }),
    })
    expect(await workspaceScope!.resolveSessionRoot('u1', 'gone')).toBeNull()
    expect(await workspaces!.resolveSessionDirectory!('u1', 'gone')).toBeNull()
  })
})

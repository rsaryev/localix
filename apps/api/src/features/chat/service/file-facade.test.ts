import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { createFileWatchService } from '../../fs-watch/service'
import type { SessionRecord } from '../repository'
import { createChatFileFacade } from './file-facade'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'file-facade-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function facade(arm: (userId: string, sessionId: string) => Promise<boolean>) {
  return createChatFileFacade({
    fileOpsCtx: {
      requireSession: async () =>
        ({ id: 's1', executionBackend: 'local' }) as unknown as SessionRecord,
      resolveSessionWorkingDir: async () => dir,
    },
    fileWatchService: { arm } as unknown as ReturnType<typeof createFileWatchService>,
    resolveSessionWorkspaceMetadata: async () => ({ rootPath: dir, projectId: null }),
  })
}

describe('chat file facade — watcher arming', () => {
  // An editor open on a file whose tree was never listed had no watcher behind it, so an
  // external change to that file never reached the open buffer as `fs.changed`.
  test('reading a file arms the session watcher', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hello')
    const armed: string[] = []
    const files = facade(async (userId, sessionId) => {
      armed.push(`${userId}:${sessionId}`)
      return true
    })
    const res = await files.readFile('u1', 's1', 'a.txt')
    expect((res as { content?: string }).content).toBe('hello')
    expect(armed).toEqual(['u1:s1'])
  })

  test('a failing arm never fails the read', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hello')
    const files = facade(async () => {
      throw new Error('watcher down')
    })
    const res = await files.readFile('u1', 's1', 'a.txt')
    expect((res as { content?: string }).content).toBe('hello')
  })
})

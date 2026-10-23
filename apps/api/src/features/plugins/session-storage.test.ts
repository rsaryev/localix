import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  discardSessionData,
  listMiniAppSessionDataDirs,
  miniAppSessionDataDir,
  resolveMiniAppSessionDataDir,
  sessionDataRoot,
  sweepOrphanSessionData,
} from './session-storage'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'session-data-'))
  roots.push(root)
  return root
}
const allow = async () => undefined

describe('plugin session storage', () => {
  test('keeps each plugin’s data under its own session, outside any sandbox', () => {
    expect(miniAppSessionDataDir('sample-plugin', 'LOCALIX-42')).toEndWith(
      '/.localix/session-data/LOCALIX-42/sample-plugin',
    )
    // An id can never step outside its own folder.
    expect(miniAppSessionDataDir('sample-plugin', 'a/../b', '/r')).toBe(
      '/r/a%2F..%2Fb/sample-plugin',
    )
    expect(() => miniAppSessionDataDir('Bad Name', 's1')).toThrow('Invalid plugin name')
  })

  test('authorizes ownership before creating or returning a directory', async () => {
    const root = tempRoot()
    const calls: string[] = []
    const refused = resolveMiniAppSessionDataDir({
      pluginName: 'sample-plugin',
      userId: 'user-a',
      sessionId: 'foreign',
      authorize: async (...args) => {
        calls.push(args.join(':'))
        throw new Error('Session not found')
      },
      root,
    })
    await expect(refused).rejects.toThrow('Session not found')
    expect(calls).toEqual(['user-a:foreign'])
    expect(existsSync(join(root, 'foreign'))).toBe(false)
  })

  test('deleting sessions removes every plugin’s data for exactly those sessions', async () => {
    const root = tempRoot()
    const dir = (plugin: string, session: string) =>
      resolveMiniAppSessionDataDir({
        pluginName: plugin,
        userId: 'u',
        sessionId: session,
        authorize: allow,
        root,
      })
    for (const [plugin, session] of [
      ['sample-plugin', 'root'],
      ['other-plugin', 'root'],
      ['sample-plugin', 'child'],
      ['sample-plugin', 'other'],
    ] as const)
      writeFileSync(join(await dir(plugin, session), 'game.json'), '{}')

    await discardSessionData(['root', 'child'], root)

    expect(existsSync(join(root, 'root'))).toBe(false)
    expect(existsSync(join(root, 'child'))).toBe(false)
    expect(existsSync(join(root, 'other', 'sample-plugin', 'game.json'))).toBe(true)
  })

  test('a session that never stored anything deletes cleanly', async () => {
    await expect(discardSessionData(['never-used'], tempRoot())).resolves.toBeUndefined()
  })
})

describe('the startup sweep', () => {
  test('an alternate database cannot sweep data belonging to another database', async () => {
    const parent = tempRoot()
    const first = sessionDataRoot(join(parent, 'first.db'))
    const second = sessionDataRoot(join(parent, 'second.db'))
    expect(first).not.toBe(second)
    expect(first).not.toBe(sessionDataRoot())

    for (const root of [first, second]) {
      const dir = await resolveMiniAppSessionDataDir({
        pluginName: 'sample-plugin',
        userId: 'u',
        sessionId: 'same-id',
        authorize: allow,
        root,
      })
      writeFileSync(join(dir, 'game.json'), '{"score":42}')
    }
    await sweepOrphanSessionData({ existing: async () => new Set(), root: first })
    expect(existsSync(join(first, 'same-id'))).toBe(false)
    expect(existsSync(join(second, 'same-id', 'sample-plugin', 'game.json'))).toBe(true)
  })

  async function seeded(...sessions: string[]) {
    const root = tempRoot()
    for (const session of sessions) {
      const dir = await resolveMiniAppSessionDataDir({
        pluginName: 'sample-plugin',
        userId: 'u',
        sessionId: session,
        authorize: allow,
        root,
      })
      writeFileSync(join(dir, 'game.json'), '{}')
    }
    return root
  }

  test('removes the folders of sessions that no longer exist, and keeps the live ones', async () => {
    const root = await seeded('live', 'gone', 'a/b')
    const removed = await sweepOrphanSessionData({
      existing: async () => new Set(['live']),
      root,
    })
    expect(removed.sort()).toEqual(['a/b', 'gone'])
    expect(existsSync(join(root, 'live', 'sample-plugin', 'game.json'))).toBe(true)
    expect(existsSync(join(root, 'gone'))).toBe(false)
  })

  test('a failed lookup removes nothing: not knowing is not proof a session is gone', async () => {
    const root = await seeded('live', 'gone')
    const sweep = sweepOrphanSessionData({
      existing: async () => {
        throw new Error('database busy')
      },
      root,
    })
    await expect(sweep).rejects.toThrow('database busy')
    expect(existsSync(join(root, 'gone'))).toBe(true)
  })

  test('no folder yet: nothing to ask the database', async () => {
    let asked = false
    const removed = await sweepOrphanSessionData({
      existing: async () => {
        asked = true
        return new Set()
      },
      root: join(tempRoot(), 'missing'),
    })
    expect(removed).toEqual([])
    expect(asked).toBe(false)
  })
})

describe('listMiniAppSessionDataDirs', () => {
  test("lists only the sessions holding this plugin's folder, creating nothing", async () => {
    const root = tempRoot()
    const allow = async () => {}
    for (const sessionId of ['a/1', 'b'])
      await resolveMiniAppSessionDataDir({
        pluginName: 'board',
        userId: 'u',
        sessionId,
        authorize: allow,
        root,
      })
    await resolveMiniAppSessionDataDir({
      pluginName: 'notes',
      userId: 'u',
      sessionId: 'c',
      authorize: allow,
      root,
    })
    const listed = await listMiniAppSessionDataDirs('board', root)
    expect(listed.map((entry) => entry.sessionId).sort()).toEqual(['a/1', 'b'])
    expect(listed.find((entry) => entry.sessionId === 'b')?.dir).toBe(
      miniAppSessionDataDir('board', 'b', root),
    )
    expect(existsSync(miniAppSessionDataDir('board', 'c', root))).toBe(false)
    expect(await listMiniAppSessionDataDirs('board', join(root, 'missing'))).toEqual([])
  })
})

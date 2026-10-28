/** `/add-dir <path>` as a person types it: what is accepted, what is refused, what is said. */
import { describe, expect, test } from 'bun:test'

import { runAddDir, type AddDirPorts } from './command-add-dir'

function ports(over: Partial<AddDirPorts> = {}) {
  const added: string[] = []
  const all: AddDirPorts = {
    cwd: '/work/app',
    homeDir: '/home/me',
    isDirectory: async () => true,
    add: (directory) => {
      added.push(directory)
      return { status: 'added', file: '/work/app/.claude/settings.local.json' }
    },
    ...over,
  }
  return { all, added }
}

describe('/add-dir', () => {
  test('explains itself without a path', async () => {
    expect(await runAddDir(ports().all, '  ')).toContain('Usage: /add-dir <path>')
  })

  test('resolves ~ and relative paths, and names the file it wrote and when it applies', async () => {
    const a = ports()
    const reply = await runAddDir(a.all, '~/shared')
    await runAddDir(a.all, '../lib')
    expect(a.added).toEqual(['/home/me/shared', '/work/lib'])
    expect(reply).toContain('/home/me/shared')
    expect(reply).toContain('settings.local.json')
    expect(reply).toContain('next message')
  })

  test('refuses what is not a folder, and writes nothing', async () => {
    const a = ports({ isDirectory: async () => false })
    expect(await runAddDir(a.all, '/etc/hosts')).toContain('is not a folder')
    expect(a.added).toEqual([])
  })

  test('says so when the folder is already added, or the file cannot be read', async () => {
    const present = ports({ add: () => ({ status: 'present', file: '/f' }) })
    expect(await runAddDir(present.all, '/x')).toContain('already')
    const bad = ports({ add: () => ({ status: 'unreadable', file: '/f' }) })
    expect(await runAddDir(bad.all, '/x')).toContain('not valid JSON')
  })
})

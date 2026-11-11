/**
 * Claude Code's auto memory folder, found where Claude Code finds it (memory.md, "Storage
 * location"), so a person's memories are the same in both: `~/.claude/projects/<project>/memory/`,
 * `<project>` the repository's main checkout with every character but letters and digits turned
 * into `-`.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import {
  autoMemoryDir,
  carryAutoMemory,
  claudeProjectKey,
  readMemoryIndex,
  rememberFact,
} from './auto-memory'

const root = tempDirPerTest('auto-memory-')

function layout() {
  const base = realpathSync(root())
  const home = join(base, 'home')
  const repo = join(base, 'work', 'my.repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(join(home, '.claude'), { recursive: true })
  return { base, home, repo, env: {} as Record<string, string | undefined> }
}

const inProjects = (home: string, project: string) =>
  join(home, '.claude', 'projects', claudeProjectKey(project), 'memory')

describe('the auto memory folder', () => {
  test('a project path names its folder as Claude Code names it', () => {
    expect(claudeProjectKey('/home/ada/.localix/workspace/LOCALIX-303')).toBe(
      '-home-ada--localix-workspace-LOCALIX-303',
    )
    const long = `/${'a'.repeat(250)}`
    const key = claudeProjectKey(long)
    expect(key.startsWith(`-${'a'.repeat(199)}-`)).toBe(true)
    expect(key).toMatch(/^-a{199}-[0-9a-z]+$/)
  })

  test('a subfolder and a linked worktree share the main checkout’s folder', () => {
    const { base, home, repo, env } = layout()
    const sub = join(repo, 'packages', 'core')
    mkdirSync(sub, { recursive: true })
    const linked = join(base, 'linked')
    mkdirSync(linked, { recursive: true })
    writeFileSync(join(linked, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'linked')}\n`)

    for (const cwd of [repo, sub, linked])
      expect(autoMemoryDir({ cwd, homeDir: home, env })).toBe(inProjects(home, repo))
  })

  test('outside a repository the working folder is the project', () => {
    const { base, home, env } = layout()
    const loose = join(base, 'loose')
    mkdirSync(loose, { recursive: true })
    expect(autoMemoryDir({ cwd: loose, homeDir: home, env })).toBe(inProjects(home, loose))
  })

  test('CLAUDE_CONFIG_DIR moves it, autoMemoryDirectory replaces it, and either switch turns it off', () => {
    const { base, home, repo } = layout()
    const config = join(base, 'config')
    mkdirSync(config, { recursive: true })
    expect(autoMemoryDir({ cwd: repo, homeDir: home, env: { CLAUDE_CONFIG_DIR: config } })).toBe(
      join(config, 'projects', claudeProjectKey(repo), 'memory'),
    )

    // A repository's committed settings may not point memory elsewhere; the person's own may.
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: '/elsewhere' }),
    )
    expect(autoMemoryDir({ cwd: repo, homeDir: home, env: {} })).toBe(inProjects(home, repo))
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: '~/notes/memory' }),
    )
    expect(autoMemoryDir({ cwd: repo, homeDir: home, env: {} })).toBe(join(home, 'notes', 'memory'))

    expect(
      autoMemoryDir({ cwd: repo, homeDir: home, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }),
    ).toBeNull()
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryEnabled: false }),
    )
    expect(autoMemoryDir({ cwd: repo, homeDir: home, env: {} })).toBeNull()
  })
})

describe('MEMORY.md', () => {
  test('loads its first 200 lines and says when there was more', async () => {
    const dir = join(root(), 'memory')
    expect(await readMemoryIndex(dir)).toEqual({ index: '', clipped: false })

    mkdirSync(dir, { recursive: true })
    const lines = Array.from({ length: 250 }, (_, i) => `- line ${i + 1}`)
    writeFileSync(join(dir, 'MEMORY.md'), lines.join('\n'))
    const loaded = await readMemoryIndex(dir)
    expect(loaded.clipped).toBe(true)
    expect(loaded.index).toContain('- line 200')
    expect(loaded.index).not.toContain('- line 201')

    writeFileSync(join(dir, 'MEMORY.md'), lines.slice(0, 3).join('\n'))
    expect(await readMemoryIndex(dir)).toEqual({
      index: lines.slice(0, 3).join('\n'),
      clipped: false,
    })
  })
})

describe('/memory <fact>', () => {
  test('saves the fact in a file of its own and points MEMORY.md at it', async () => {
    const dir = join(root(), 'memory')
    const first = await rememberFact(dir, 'We deploy on Fridays only')
    expect(first).toBe('we-deploy-on-fridays-only.md')
    expect(readFileSync(join(dir, first), 'utf8')).toContain('We deploy on Fridays only')
    expect(readFileSync(join(dir, first), 'utf8')).toStartWith(
      '---\nname: we-deploy-on-fridays-only\n',
    )

    // The same words again keep the first file and get one of their own.
    const second = await rememberFact(dir, 'We deploy on Fridays only')
    expect(second).toBe('we-deploy-on-fridays-only-2.md')
    const index = (await readMemoryIndex(dir)).index.split('\n')
    expect(index).toEqual([
      `- [We deploy on Fridays only](${first}) — We deploy on Fridays only`,
      `- [We deploy on Fridays only](${second}) — We deploy on Fridays only`,
    ])
  })

  test('a fact in another script keeps its words in the file name, not a shared `note`', async () => {
    const dir = join(root(), 'memory')
    const greek = await rememberFact(dir, 'Ανάπτυξη μόνο Παρασκευή')
    const other = await rememberFact(dir, 'Τρέχουμε τα τεστ με bun')
    expect(greek).toBe('ανάπτυξη-μόνο-παρασκευή.md')
    expect(other).toBe('τρέχουμε-τα-τεστ-με-bun.md')
    expect(readFileSync(join(dir, greek), 'utf8')).toContain('Ανάπτυξη μόνο Παρασκευή')
  })

  test('a fact with no letters or digits still gets a file', async () => {
    const dir = join(root(), 'memory')
    expect(await rememberFact(dir, '!!!')).toBe('note.md')
  })

  test('brackets in the first line stay inside the index entry’s link text', async () => {
    const dir = join(root(), 'memory')
    const file = await rememberFact(dir, 'Use arr[0] and [draft] flags')
    const [entry] = (await readMemoryIndex(dir)).index.split('\n')
    expect(entry).toBe(
      `- [Use arr\\[0\\] and \\[draft\\] flags](${file}) — Use arr[0] and [draft] flags`,
    )
  })
})

describe('carrying memory to a project’s new folder', () => {
  test('the old folder’s memory is copied to the new folder’s, and the old one is left', async () => {
    const { base, home, env } = layout()
    const from = join(base, 'work', 'claude-plugin-kit')
    const to = join(base, 'work', 'llx-plugin')
    mkdirSync(to, { recursive: true })
    await rememberFact(inProjects(home, from), 'We deploy on Fridays only')
    expect(await carryAutoMemory({ from, to, homeDir: home, env })).toBe('copied')
    expect((await readMemoryIndex(inProjects(home, to))).index).toContain('Fridays')
    expect((await readMemoryIndex(inProjects(home, from))).index).toContain('Fridays')
  })

  test('a new folder that already has memory keeps its own; nothing is merged', async () => {
    const { base, home, env } = layout()
    const from = join(base, 'old')
    const to = join(base, 'new')
    mkdirSync(to)
    await rememberFact(inProjects(home, from), 'old fact')
    await rememberFact(inProjects(home, to), 'its own fact')
    expect(await carryAutoMemory({ from, to, homeDir: home, env })).toBe('kept')
    const index = (await readMemoryIndex(inProjects(home, to))).index
    expect(index).toContain('its own fact')
    expect(index).not.toContain('old fact')
  })

  test('no memory to carry, memory turned off, or one configured folder for all: nothing', async () => {
    const { base, home, env } = layout()
    const from = join(base, 'a')
    const to = join(base, 'b')
    mkdirSync(to)
    expect(await carryAutoMemory({ from, to, homeDir: home, env })).toBe('none')
    await rememberFact(inProjects(home, from), 'fact')
    const off = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
    expect(await carryAutoMemory({ from, to, homeDir: home, env: off })).toBe('none')
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: join(base, 'shared-memory') }),
    )
    expect(await carryAutoMemory({ from, to, homeDir: home, env })).toBe('none')
  })
})

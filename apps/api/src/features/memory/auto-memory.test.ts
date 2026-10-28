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

import { autoMemoryDir, claudeProjectKey, readMemoryIndex, rememberFact } from './auto-memory'

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

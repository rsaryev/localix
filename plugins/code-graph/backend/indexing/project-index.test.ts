import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverFiles } from './discover'
import { ProjectIndex } from './project-index'

const made: string[] = []
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-'))
  made.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('discoverFiles', () => {
  test('honours nested .gitignore files and always skips dependency trees', async () => {
    const root = project({
      '.gitignore': 'generated/\n',
      'src/a.ts': 'export const a = 1',
      'src/.gitignore': 'secret.ts\n',
      'src/secret.ts': 'x',
      'generated/g.ts': 'x',
      'node_modules/pkg/index.js': 'x',
      'README.md': '# not source',
      'package.json': '{"name":"demo"}',
    })
    const { files, configs } = await discoverFiles(root)
    expect(files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(configs.map((c) => c.path)).toEqual(['package.json'])
  })

  // The walk used to read `.gitignore` only, so a file excluded locally through `info/exclude` or
  // a global ignore was mapped as project code while git treated it as absent.
  test('honours .git/info/exclude and core.excludesFile, relative to the repository top', async () => {
    const home = project({
      '.gitconfig': '[user]\n  name = x\n[core]\n  excludesFile = ~/global-ignore\n',
      'global-ignore': '*.local.ts\n',
    })
    const repo = project({
      '.git/info/exclude': '# local only\npackages/app/scratch/\n',
      'packages/app/src/a.ts': 'export const a = 1',
      'packages/app/src/b.local.ts': 'x',
      'packages/app/scratch/notes.ts': 'x',
    })
    const env = { home, xdgConfigHome: join(home, '.config') }
    // The project is a package of the repository: the rules name paths from the top level.
    const { files } = await discoverFiles(join(repo, 'packages/app'), { excludes: env })
    expect(files.map((f) => f.path)).toEqual(['src/a.ts'])
  })

  test('falls back to $XDG_CONFIG_HOME/git/ignore and follows a worktree’s .git file', async () => {
    const home = project({ '.config/git/ignore': 'gen/\n' })
    const main = project({
      '.git/info/exclude': 'tmp.ts\n',
      '.git/worktrees/wt/commondir': '../..',
    })
    const tree = project({
      '.git': `gitdir: ${join(main, '.git/worktrees/wt')}\n`,
      'src/a.ts': 'export const a = 1',
      'gen/g.ts': 'x',
      'tmp.ts': 'x',
    })
    const env = { home, xdgConfigHome: join(home, '.config') }
    const { files } = await discoverFiles(tree, { excludes: env })
    expect(files.map((f) => f.path)).toEqual(['src/a.ts'])
  })
})

describe('ProjectIndex', () => {
  test('builds, then re-parses only what changed', async () => {
    const root = project({
      'a.ts': "import { b } from './b'\nexport function a() { b() }",
      'b.ts': 'export function b() {}',
    })
    const index = new ProjectIndex(root, join(root, '.cache'))
    const first = await index.refresh()
    expect(first?.stats.edges.calls).toBe(1)
    expect(index.snapshot()).toMatchObject({ state: 'ready', revision: 1 })

    // Unchanged: the same graph object is kept and the revision does not move.
    const same = await index.refresh()
    expect(same).toBe(first)

    writeFileSync(join(root, 'c.ts'), "import { a } from './a'\nexport function c() { a() }")
    const next = await index.refresh()
    expect(next?.revision).toBe(2)
    expect(next?.stats.edges.calls).toBe(2)
    index.close()
  })

  test('the cache survives a new index over the same directory', async () => {
    const root = project({ 'a.ts': 'export function a() {}' })
    const cacheDir = join(root, '.cache')
    const first = new ProjectIndex(root, cacheDir)
    await first.refresh()
    first.close()
    const second = new ProjectIndex(root, cacheDir)
    const published = await second.refresh()
    expect(published?.stats.symbols).toBe(1)
    second.close()
  })

  // A change heard while a refresh is walking may be behind its cursor; joining that refresh lost
  // it until the next backstop check, minutes away once the tab stopped polling for freshness.
  test('a change during a refresh queues one more, and listeners hear each end', async () => {
    const root = project({ 'a.ts': 'export function a() {}' })
    const index = new ProjectIndex(root, join(root, '.cache'))
    const revisions: number[] = []
    index.subscribe((status) => revisions.push(status.revision))
    const first = index.refresh()
    writeFileSync(join(root, 'b.ts'), 'export function b() {}')
    index.changed()
    index.changed()
    await first
    // The queued refresh is running now; wait for it the way a caller would.
    await index.refresh()
    expect(index.current?.stats.symbols).toBe(2)
    // Two refreshes ran — the one in flight and exactly one queued by the two changes — whether
    // or not the first walk happened to reach `b.ts` before it was written.
    expect(revisions).toHaveLength(2)
    index.close()
  })

  test('a project that turns unreadable keeps the last good graph', async () => {
    const root = project({ 'a.ts': 'export function a() {}' })
    const index = new ProjectIndex(root, join(root, '.cache'))
    const good = await index.refresh()
    rmSync(join(root, 'a.ts'))
    const after = await index.refresh()
    expect(after).toBe(good)
    expect(index.snapshot().error).toContain('could not be read')
    index.close()
  })
})

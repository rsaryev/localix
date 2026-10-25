import { describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localixHome } from '../../lib/env'
import { extractCallFacts, writeTargets } from './permission-facts'
import { sessionScratchRoot } from './tools/workspace'

const root = '/work/project'

describe('reader containment', () => {
  test('a read inside the workspace is not outside', () => {
    expect(extractCallFacts('read', { path: `${root}/src/a.ts` }, root).outsideWorkspace).toBe(
      false,
    )
  })

  test("a read of the agent's own scratch file is not outside — the agent wrote it a call ago", () => {
    const scratch = path.join(sessionScratchRoot(), 'LOCALIX-42', 'test.js')
    expect(extractCallFacts('read', { path: scratch }, root).outsideWorkspace).toBe(false)
    const shot = path.join(sessionScratchRoot(), 'LOCALIX-42', 'shot.png')
    expect(extractCallFacts('read', { path: shot }, root).outsideWorkspace).toBe(false)
  })

  // Every read of the plugin the agent had just been asked to build used to prompt.
  test("the user's plugins and skills read and write like the workspace, in every role", () => {
    for (const file of [
      path.join(localixHome(), 'plugins/timer/plugin.json'),
      path.join(os.homedir(), '.claude/skills/review/SKILL.md'),
      path.join(localixHome(), 'workspace/x/a.md'),
    ]) {
      const dir = path.basename(path.dirname(file))
      for (const tool of ['read', 'search', 'write']) {
        const input = tool === 'search' ? { query: 'x', path: file } : { path: file, content: 'x' }
        expect({
          tool,
          dir,
          outside: extractCallFacts(tool, input, root).outsideWorkspace,
        }).toEqual({ tool, dir, outside: false })
      }
    }
  })

  // The old root was all of `~/.localix`, which made these silently WRITABLE by any agent.
  test('the database, the vault and the captured shell environment prompt for a write too', () => {
    for (const dir of ['localix.db', 'vault/keys.json', 'login-shell-env.json', 'backups/b.db']) {
      const file = path.join(localixHome(), dir)
      expect(extractCallFacts('write', { path: file, content: 'x' }, root).outsideWorkspace).toBe(
        true,
      )
    }
  })

  test('the wider agent-owned root stays outside for readers: the database is not context', () => {
    const db = path.join(localixHome(), 'localix.db')
    expect(extractCallFacts('read', { path: db }, root).outsideWorkspace).toBe(true)
  })

  // `edit` once had no case in the extractor, so its call carried NO paths: neither the
  // workspace classes nor `secrets` could see the file it rewrites.
  test('an edit is judged on its file exactly like a write', () => {
    const edit = (file: string) =>
      extractCallFacts('edit', { path: file, old_string: 'a', new_string: 'b' }, root)
    const inside = edit('src/a.ts')
    expect(inside.paths).toEqual([`${root}/src/a.ts`])
    expect(inside.insideWorkspace).toBe(true)
    expect(inside.outsideWorkspace).toBe(false)
    expect(edit('/etc/hosts').outsideWorkspace).toBe(true)
    expect(edit(`${root}/.env.local`).touchesSecret).toBe(true)
    expect(writeTargets('edit', { path: 'src/a.ts', cwd: root }, root)).toEqual([
      `${root}/src/a.ts`,
    ])
  })

  // A batch is ONE approval: every file it names is a fact, and one file outside the workspace
  // (or one secret) makes the whole call so. Reading only a top-level `path` saw nothing here.
  test('a batched edit or write lists every file it names', () => {
    const edit = extractCallFacts(
      'edit',
      {
        edits: [
          { path: 'src/a.ts', old_string: 'a', new_string: 'b' },
          { path: 'src/b.ts', old_string: 'a', new_string: 'b' },
          { path: 'src/a.ts', old_string: 'b', new_string: 'c' },
        ],
      },
      root,
    )
    expect(edit.paths).toEqual([`${root}/src/a.ts`, `${root}/src/b.ts`])
    expect(edit.insideWorkspace).toBe(true)

    const write = extractCallFacts(
      'write',
      {
        files: [
          { path: 'src/a.ts', content: 'x' },
          { path: '/etc/hosts', content: 'x' },
          { path: '.env', content: 'x' },
        ],
      },
      root,
    )
    expect(write.paths).toEqual([`${root}/src/a.ts`, '/etc/hosts', `${root}/.env`])
    expect(write.outsidePaths).toEqual(['/etc/hosts'])
    expect(write.outsideWorkspace).toBe(true)
    expect(write.insideWorkspace).toBe(false)
    expect(write.touchesSecret).toBe(true)
    expect(
      writeTargets('write', { files: [{ path: 'a.ts' }, { path: 'b.ts' }], cwd: root }, root),
    ).toEqual([`${root}/a.ts`, `${root}/b.ts`])
  })

  test('a mutation under the agent-owned root keeps its carve-out', () => {
    const scratch = path.join(sessionScratchRoot(), 'LOCALIX-42', 'test.js')
    expect(extractCallFacts('write', { path: scratch, content: 'x' }, root).outsideWorkspace).toBe(
      false,
    )
  })
})

describe('batched reads', () => {
  test('every `reads` entry is a path fact, judged for containment like `path`', () => {
    const facts = extractCallFacts(
      'read',
      { path: 'src/a.ts', reads: [{ path: 'src/b.ts' }, { path: '/etc/passwd' }, 'c.ts'] },
      root,
    )
    expect(facts.paths).toEqual([
      `${root}/src/a.ts`,
      `${root}/src/b.ts`,
      '/etc/passwd',
      `${root}/c.ts`,
    ])
    expect(facts.outsidePaths).toEqual(['/etc/passwd'])
    expect(facts.outsideWorkspace).toBe(true)
    expect(facts.insideWorkspace).toBe(false)
  })

  test('a batch that names a credential touches a secret, whichever entry it is', () => {
    const facts = extractCallFacts(
      'read',
      { reads: [{ path: 'README.md' }, { path: '.env' }] },
      root,
    )
    expect(facts.touchesSecret).toBe(true)
  })

  test("search's `path` scope is a path fact too", () => {
    const facts = extractCallFacts('search', { query: 'x', path: '/etc' }, root)
    expect(facts.paths).toContain('/etc')
    expect(facts.outsideWorkspace).toBe(true)
  })
})

describe('mutation containment through a symlinked directory', () => {
  const tmp = tempDirPerTest('facts-symlink-')

  // A directory link inside the workspace that points out of it (one a cloned repo can carry)
  // read as contained, so a write or edit through it skipped the outside-workspace ask while
  // the OS followed the link and changed the file outside.
  test('a write or edit through a linked folder pointing out is outside the workspace', () => {
    const ws = path.join(tmp(), 'ws')
    const outside = path.join(tmp(), 'outside')
    mkdirSync(ws)
    mkdirSync(outside)
    writeFileSync(path.join(outside, 'existing.txt'), 'a')
    symlinkSync(outside, path.join(ws, 'link'))
    const write = extractCallFacts('write', { files: [{ path: 'link/new.txt', content: 'x' }] }, ws)
    expect(write.outsidePaths).toEqual([path.join(ws, 'link', 'new.txt')])
    const edit = extractCallFacts(
      'edit',
      { edits: [{ path: 'link/existing.txt', old_string: 'a', new_string: 'b' }] },
      ws,
    )
    expect(edit.outsideWorkspace).toBe(true)
    // An ordinary new file in a new folder of the workspace stays inside.
    const plain = extractCallFacts('write', { path: 'src/new/a.ts', content: 'x' }, ws)
    expect(plain.outsideWorkspace).toBe(false)
  })
})

describe('skill call facts', () => {
  test('a save names the SKILL.md it writes, by scope; a get and the removed actions name nothing', () => {
    const project = extractCallFacts(
      'skill',
      { action: 'save', name: 'ship', scope: 'project' },
      root,
    )
    expect(project.paths).toEqual([path.join(root, '.claude/skills/ship/SKILL.md')])
    const global = extractCallFacts(
      'skill',
      { action: 'save', name: 'ship', scope: 'global' },
      root,
    )
    expect(global.paths).toEqual([path.join(os.homedir(), '.claude/skills/ship/SKILL.md')])
    for (const input of [
      { action: 'get', name: 'ship' },
      // `delete` once declared both candidate folders; it is the Store's now.
      { action: 'delete', name: 'ship' },
      { action: 'list' },
    ])
      expect(extractCallFacts('skill', input, root).paths).toEqual([])
  })
})

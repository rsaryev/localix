import { describe, expect, test } from 'bun:test'
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
    expect(extractCallFacts('view_image', { path: scratch }, root).outsideWorkspace).toBe(false)
  })

  // Every read of the plugin the agent had just been asked to build used to prompt.
  test("the user's plugins and skills read and write like the workspace, in every role", () => {
    for (const dir of ['plugins/timer/plugin.json', 'skills/review/SKILL.md', 'workspace/x/a.md']) {
      const file = path.join(localixHome(), dir)
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

  test('a mutation under the agent-owned root keeps its carve-out', () => {
    const scratch = path.join(sessionScratchRoot(), 'LOCALIX-42', 'test.js')
    expect(extractCallFacts('write', { path: scratch, content: 'x' }, root).outsideWorkspace).toBe(
      false,
    )
  })
})

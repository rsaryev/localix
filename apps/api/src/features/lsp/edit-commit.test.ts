/**
 * `commitWorkspaceEdit`'s behaviour when one file of many cannot be written.
 *
 * A workspace edit is committed file-by-file with no rollback — that is a property of the filesystem,
 * not a bug. What WAS a bug: the loop let a write error escape, which threw away the list of files it
 * had already committed. A cross-file rename that failed on file 3 of 5 therefore left the workspace
 * half-renamed (code that does not compile) and reported an opaque error naming none of it.
 *
 * The failure is ordinary, not exotic: `commitFile` passes `contentHash(before)` to the write path
 * for optimistic concurrency, so a user editing that file in the editor while the agent renames is
 * exactly what trips it.
 *
 * Policy: each file is applied independently — a failure in one file does NOT block the others,
 * and the result lists exactly which files failed.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLspEditCommitter } from './edit-commit'
import type { LspWorkspaceEditFile } from './lsp-protocol'

/** Replace line 0 entirely — enough of a real edit that before !== after. */
const replaceFirstLine = (text: string) => [
  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } }, newText: text },
]

async function fixture(names: string[]): Promise<{ dir: string; edits: LspWorkspaceEditFile[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-commit-'))
  const edits: LspWorkspaceEditFile[] = []
  for (const name of names) {
    const file = join(dir, name)
    await fsWriteFile(file, 'const oldName = 1\n')
    edits.push({ file, edits: replaceFirstLine('const newName = 1') } as LspWorkspaceEditFile)
  }
  return { dir, edits }
}

describe('one file failing to write', () => {
  test('does not discard the files already committed', async () => {
    const { edits } = await fixture(['a.ts', 'b.ts', 'c.ts'])
    const written: string[] = []
    const committer = createLspEditCommitter(async (_u, _s, file) => {
      if (file.endsWith('b.ts')) throw new Error('content changed since it was read')
      written.push(file)
      return { hash: 'h' }
    })

    const result = await committer.commitWorkspaceEdit('u1', 's1', edits)
    // The whole point: a.ts and c.ts are on disk, and the caller can say so.
    expect(result.changedFiles).toHaveLength(2)
    expect(result.changedFiles.some((f) => f.endsWith('a.ts'))).toBe(true)
    expect(result.changedFiles.some((f) => f.endsWith('c.ts'))).toBe(true)
    expect(written).toHaveLength(2)
  })

  test('names the file and the reason', async () => {
    const { edits } = await fixture(['a.ts', 'b.ts'])
    const committer = createLspEditCommitter(async (_u, _s, file) => {
      if (file.endsWith('b.ts')) throw new Error('content changed since it was read')
      return { hash: 'h' }
    })

    const result = await committer.commitWorkspaceEdit('u1', 's1', edits)
    expect(result.failed).toHaveLength(1)
    expect(result.failed?.[0]?.file.endsWith('b.ts')).toBe(true)
    // The reason has to travel: "it failed" without why sends the caller to `git status` blind.
    expect(result.failed?.[0]?.reason).toContain('content changed')
  })

  test('a LATER file still gets its turn — the loop is not abandoned', async () => {
    // Ordering matters: with the old behaviour the throw on the first file meant b and c never ran
    // at all, so a single stale buffer silently cancelled the rest of the rename.
    const { edits } = await fixture(['a.ts', 'b.ts', 'c.ts'])
    const attempted: string[] = []
    const committer = createLspEditCommitter(async (_u, _s, file) => {
      attempted.push(file)
      if (file.endsWith('a.ts')) throw new Error('locked')
      return { hash: 'h' }
    })

    const result = await committer.commitWorkspaceEdit('u1', 's1', edits)
    expect(attempted).toHaveLength(3)
    expect(result.changedFiles).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
  })

  test('every file failing yields no changes and every reason', async () => {
    const { edits } = await fixture(['a.ts', 'b.ts'])
    const committer = createLspEditCommitter(async () => {
      throw new Error('read-only filesystem')
    })

    const result = await committer.commitWorkspaceEdit('u1', 's1', edits)
    expect(result.changedFiles).toEqual([])
    expect(result.failed).toHaveLength(2)
  })
})

describe('a clean commit', () => {
  test('reports no failures at all — the field is absent, not an empty array', async () => {
    // Absent keeps `outcome.failed?.length` falsy at every call site without a special case, and
    // keeps a clean result byte-identical to what it was before this change.
    const { edits } = await fixture(['a.ts', 'b.ts'])
    const committer = createLspEditCommitter(async () => ({ hash: 'h' }))

    const result = await committer.commitWorkspaceEdit('u1', 's1', edits)
    expect(result.changedFiles).toHaveLength(2)
    expect(result.failed).toBeUndefined()
    expect(result.files.every((f) => f.diff.includes('newName'))).toBe(true)
  })

  test('an unreadable or no-op file is skipped, NOT reported as failed', async () => {
    // A file the server saw and that has since vanished, and an edit that changes nothing, are both
    // ordinary outcomes — calling them failures would cry wolf on every organize-imports no-op.
    const { dir, edits } = await fixture(['a.ts'])
    const missing = join(dir, 'gone.ts')
    const noop = join(dir, 'same.ts')
    await fsWriteFile(noop, 'const oldName = 1\n')
    const committer = createLspEditCommitter(async () => ({ hash: 'h' }))

    const result = await committer.commitWorkspaceEdit('u1', 's1', [
      ...edits,
      { file: missing, edits: replaceFirstLine('x') } as LspWorkspaceEditFile,
      // A genuine zero-width no-op: inserting nothing at 0:0 leaves before === after.
      {
        file: noop,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: '',
          },
        ],
      } as LspWorkspaceEditFile,
    ])
    expect(result.changedFiles).toHaveLength(1)
    expect(result.failed).toBeUndefined()
  })
})

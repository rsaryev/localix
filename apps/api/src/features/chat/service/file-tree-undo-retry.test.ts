import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { renameEntry, undoLastFileOp } from './file-tree-ops'
import { clearFileOpJournal } from './file-op-journal'
import type { FileOpsContext } from './file-ops-context'

test('Undo keeps a failed restore in the journal so a repaired source can be retried', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'undo-retry-'))
  const sessionId = `undo-${crypto.randomUUID()}`
  const ctx: FileOpsContext = {
    requireSession: async () => ({ id: sessionId, executionBackend: 'local' }) as never,
    resolveSessionWorkingDir: async () => dir,
  }
  try {
    await writeFile(path.join(dir, 'a.txt'), 'original')
    await renameEntry(ctx, 'u', sessionId, 'a.txt', 'b.txt')
    await rm(path.join(dir, 'b.txt'))
    await expect(undoLastFileOp(ctx, 'u', sessionId)).rejects.toMatchObject({
      status: 500,
      code: 'undo_failed',
    })
    await writeFile(path.join(dir, 'b.txt'), 'recovered')
    await expect(undoLastFileOp(ctx, 'u', sessionId)).resolves.toMatchObject({
      undone: true,
      kind: 'move',
      restoredPath: path.join(dir, 'a.txt'),
    })
    expect(await readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('recovered')
    expect(await undoLastFileOp(ctx, 'u', sessionId)).toEqual({ undone: false })
  } finally {
    clearFileOpJournal(sessionId)
    await rm(dir, { recursive: true, force: true })
  }
})

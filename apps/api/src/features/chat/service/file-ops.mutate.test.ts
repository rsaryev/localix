import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createEntry,
  renameEntry,
  deleteEntry,
  pasteEntry,
  duplicateEntry,
  undoLastFileOp,
  listDirectory,
  incrementName,
  writeFile,
} from './file-ops'
import { listRemoteDirectory } from './file-content'
import type { FileOpsContext } from './file-ops'
import { contentHash } from './file-ops-context'
import { clearFileOpJournal } from './file-op-journal'
import type { SessionRecord } from '../repository'
import { withPathLock } from '../../agent-core/tools/file/file-utils'
import type { ExecutionEnvironment } from '../../agent-core/tools/environment'

// A local-backend session whose working dir is a throwaway temp folder, so the
// create/rename/delete ops exercise the real shell path end-to-end.
let dir: string
let trash: string
const ctx = (): FileOpsContext => ({
  requireSession: async () => ({ id: 's1', executionBackend: 'local' }) as unknown as SessionRecord,
  resolveSessionWorkingDir: async () => dir,
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fileops-'))
  // Isolate the trash so a delete never touches the real ~/.localix/trash.
  trash = mkdtempSync(path.join(tmpdir(), 'fileops-trash-'))
  process.env.LOCALIX_TRASH_DIR = trash
  clearFileOpJournal('s1')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(trash, { recursive: true, force: true })
  delete process.env.LOCALIX_TRASH_DIR
})

describe('file-ops mutations', () => {
  test('createEntry makes a file under a nested parent', async () => {
    const res = await createEntry(ctx(), 'u', 's1', 'a/b', 'note.txt', 'file')
    expect(res.type).toBe('file')
    expect(existsSync(res.path)).toBe(true)
    expect(res.path).toBe(path.join(dir, 'a/b/note.txt'))
  })

  test('createEntry makes a directory', async () => {
    const res = await createEntry(ctx(), 'u', 's1', '.', 'sub', 'dir')
    expect(res.type).toBe('dir')
    expect(existsSync(path.join(dir, 'sub'))).toBe(true)
  })

  test('createEntry refuses to clobber an existing entry', () => {
    writeFileSync(path.join(dir, 'x.txt'), 'hi')
    expect(createEntry(ctx(), 'u', 's1', '.', 'x.txt', 'file')).rejects.toThrow()
  })

  test('createEntry rejects a name with a path separator', () => {
    expect(createEntry(ctx(), 'u', 's1', '.', 'a/b', 'file')).rejects.toThrow()
  })

  test('renameEntry moves within the same folder and reports kind', async () => {
    writeFileSync(path.join(dir, 'old.txt'), 'hi')
    const res = await renameEntry(ctx(), 'u', 's1', 'old.txt', 'new.txt')
    expect(res.type).toBe('file')
    expect(existsSync(path.join(dir, 'old.txt'))).toBe(false)
    expect(existsSync(path.join(dir, 'new.txt'))).toBe(true)
  })

  test('a same-name directory rename is a typed no-op, not a fake file result', async () => {
    mkdirSync(path.join(dir, 'folder'))
    expect(await renameEntry(ctx(), 'u', 's1', 'folder', 'folder')).toEqual({
      path: path.join(dir, 'folder'),
      type: 'dir',
    })
  })

  test('renameEntry refuses to overwrite a sibling', () => {
    writeFileSync(path.join(dir, 'a.txt'), 'a')
    writeFileSync(path.join(dir, 'b.txt'), 'b')
    expect(renameEntry(ctx(), 'u', 's1', 'a.txt', 'b.txt')).rejects.toThrow()
  })

  test('deleteEntry removes a directory tree', async () => {
    await createEntry(ctx(), 'u', 's1', 'deep/nest', 'f.txt', 'file')
    const res = await deleteEntry(ctx(), 'u', 's1', 'deep')
    expect(res.deleted).toBe(true)
    expect(existsSync(path.join(dir, 'deep'))).toBe(false)
  })

  test('pasteEntry move relocates a file into another folder', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    await createEntry(ctx(), 'u', 's1', '.', 'dest', 'dir')
    const res = await pasteEntry(ctx(), 'u', 's1', 'note.txt', 'dest', 'move')
    expect(res.path).toBe(path.join(dir, 'dest/note.txt'))
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(false)
    expect(existsSync(path.join(dir, 'dest/note.txt'))).toBe(true)
  })

  test('pasteEntry copy duplicates and auto-increments on same-folder collision', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    const res = await pasteEntry(ctx(), 'u', 's1', 'note.txt', '.', 'copy')
    expect(res.path).toBe(path.join(dir, 'note copy.txt'))
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(true)
    expect(existsSync(path.join(dir, 'note copy.txt'))).toBe(true)
  })

  test('pasteEntry copy recurses into directories', async () => {
    await createEntry(ctx(), 'u', 's1', 'src/inner', 'f.txt', 'file')
    await createEntry(ctx(), 'u', 's1', '.', 'target', 'dir')
    const res = await pasteEntry(ctx(), 'u', 's1', 'src', 'target', 'copy')
    expect(res.type).toBe('dir')
    expect(existsSync(path.join(dir, 'target/src/inner/f.txt'))).toBe(true)
  })

  test('pasteEntry move refuses to overwrite an existing entry', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'a')
    await createEntry(ctx(), 'u', 's1', 'dest', 'a.txt', 'file')
    expect(pasteEntry(ctx(), 'u', 's1', 'a.txt', 'dest', 'move')).rejects.toThrow()
  })

  test('pasteEntry refuses to paste a folder into its own descendant', async () => {
    await createEntry(ctx(), 'u', 's1', 'top/mid', 'f.txt', 'file')
    expect(pasteEntry(ctx(), 'u', 's1', 'top', 'top/mid', 'copy')).rejects.toThrow()
  })
})

describe('trash + undo', () => {
  test('deleteEntry moves the entry to the trash and reports trashed', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    const res = await deleteEntry(ctx(), 'u', 's1', 'note.txt')
    expect(res.trashed).toBe(true)
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(false)
    // A single file now lives under the trash dir with a timestamp prefix.
    const trashed = require('node:fs').readdirSync(trash) as string[]
    expect(trashed.some((n) => n.endsWith('-note.txt'))).toBe(true)
  })

  test('deleteEntry permanent skips the trash', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    const res = await deleteEntry(ctx(), 'u', 's1', 'note.txt', { permanent: true })
    expect(res.trashed).toBeUndefined()
    expect(require('node:fs').readdirSync(trash).length).toBe(0)
  })

  test('deleteEntry refuses to mutate the session workspace root', async () => {
    writeFileSync(path.join(dir, 'keep.txt'), 'safe')

    expect(deleteEntry(ctx(), 'u', 's1', dir, { permanent: true })).rejects.toMatchObject({
      code: 'refused',
    })
    expect(readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('safe')
  })

  test('undo restores a trashed entry to its original path', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    await deleteEntry(ctx(), 'u', 's1', 'note.txt')
    const undo = await undoLastFileOp(ctx(), 'u', 's1')
    expect(undo.undone).toBe(true)
    expect(undo.kind).toBe('trash')
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(true)
  })

  test('undo reverses a rename', async () => {
    writeFileSync(path.join(dir, 'old.txt'), 'hi')
    await renameEntry(ctx(), 'u', 's1', 'old.txt', 'new.txt')
    const undo = await undoLastFileOp(ctx(), 'u', 's1')
    expect(undo.undone).toBe(true)
    expect(undo.kind).toBe('move')
    expect(existsSync(path.join(dir, 'old.txt'))).toBe(true)
    expect(existsSync(path.join(dir, 'new.txt'))).toBe(false)
  })

  test('undo reverses a paste-move back to the source folder', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    await createEntry(ctx(), 'u', 's1', '.', 'dest', 'dir')
    await pasteEntry(ctx(), 'u', 's1', 'note.txt', 'dest', 'move')
    const undo = await undoLastFileOp(ctx(), 'u', 's1')
    expect(undo.undone).toBe(true)
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(true)
    expect(existsSync(path.join(dir, 'dest/note.txt'))).toBe(false)
  })

  test('undo refuses when the restore target is occupied again', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    await deleteEntry(ctx(), 'u', 's1', 'note.txt')
    // Recreate a file at the original path — the undo must not clobber it.
    writeFileSync(path.join(dir, 'note.txt'), 'new')
    expect(undoLastFileOp(ctx(), 'u', 's1')).rejects.toThrow()
  })

  test('undo with an empty journal reports nothing undone', async () => {
    const undo = await undoLastFileOp(ctx(), 'u', 's1')
    expect(undo.undone).toBe(false)
  })

  test('undo never follows an absolute-path journal entry into a previous workspace', async () => {
    const previousWorkspace = dir
    writeFileSync(path.join(previousWorkspace, 'old.txt'), 'hi')
    await renameEntry(ctx(), 'u', 's1', 'old.txt', 'renamed.txt')
    const nextWorkspace = mkdtempSync(path.join(tmpdir(), 'fileops-next-'))
    dir = nextWorkspace

    try {
      expect(await undoLastFileOp(ctx(), 'u', 's1')).toEqual({ undone: false })
      expect(existsSync(path.join(previousWorkspace, 'old.txt'))).toBe(false)
      expect(readFileSync(path.join(previousWorkspace, 'renamed.txt'), 'utf8')).toBe('hi')
    } finally {
      dir = previousWorkspace
      rmSync(nextWorkspace, { recursive: true, force: true })
    }
  })
})

describe('listDirectory cap', () => {
  test('returns all entries and no truncated field under the cap', async () => {
    for (let i = 0; i < 5; i++) writeFileSync(path.join(dir, `f${i}.txt`), 'x')
    const res = await listDirectory(ctx(), 'u', 's1')
    expect(res.entries.length).toBe(5)
    expect(res.truncated).toBeUndefined()
  })

  test('preserves a legal newline in a local filename as one entry', async () => {
    const name = 'line\nbreak.txt'
    writeFileSync(path.join(dir, name), 'x')

    const res = await listDirectory(ctx(), 'u', 's1')

    expect(res.entries).toEqual([{ name, type: 'file' }])
  })

  test('caps a huge directory at 1000 entries and reports the omitted count', async () => {
    for (let i = 0; i < 1005; i++)
      writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.txt`), 'x')
    const res = await listDirectory(ctx(), 'u', 's1')
    expect(res.entries.length).toBe(1000)
    expect(res.truncated).toBe(5)
  })

  test('bounds remote transport while preserving the exact omitted count', async () => {
    const shown = Array.from({ length: 1000 }, (_, i) => `f${String(i).padStart(4, '0')}.txt`)
    let command = ''
    const env = {
      async exec(nextCommand: string) {
        command = nextCommand
        return {
          stdout: `1005\n\0${shown.map((name) => `./${name}\0`).join('')}`,
          stderr: '',
          exitCode: 0,
        }
      },
    } as ExecutionEnvironment

    const result = await listRemoteDirectory(env, '/remote/huge')

    expect(command).toContain(`head -c ${1000 * 258 + 1}`)
    expect(result?.entries).toHaveLength(1000)
    expect(result?.entries[0]).toEqual({ name: 'f0000.txt', type: 'file' })
    expect(result?.total).toBe(1005)
  })
})

describe('duplicateEntry', () => {
  test('copies a file into its own folder with an incremented name', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    const res = await duplicateEntry(ctx(), 'u', 's1', 'note.txt')
    expect(res.path).toBe(path.join(dir, 'note copy.txt'))
    expect(existsSync(path.join(dir, 'note.txt'))).toBe(true)
    expect(existsSync(path.join(dir, 'note copy.txt'))).toBe(true)
  })

  test('resolves one session-directory snapshot for both duplicate paths', async () => {
    writeFileSync(path.join(dir, 'note.txt'), 'hi')
    let sessionReads = 0
    const oneSnapshot: FileOpsContext = {
      requireSession: async () => {
        sessionReads += 1
        return { id: 's1', executionBackend: 'local' } as SessionRecord
      },
      resolveSessionWorkingDir: async () => dir,
    }

    await duplicateEntry(oneSnapshot, 'u', 's1', 'note.txt')
    expect(sessionReads).toBe(1)
    expect(existsSync(path.join(dir, 'note copy.txt'))).toBe(true)
  })

  test('duplicates a directory tree', async () => {
    await createEntry(ctx(), 'u', 's1', 'src/inner', 'f.txt', 'file')
    const res = await duplicateEntry(ctx(), 'u', 's1', 'src')
    expect(res.type).toBe('dir')
    expect(existsSync(path.join(dir, 'src copy/inner/f.txt'))).toBe(true)
  })
})

describe('incrementName', () => {
  test('appends " copy" before the extension', () => {
    expect(incrementName('report.txt', false)).toBe('report copy.txt')
  })
  test('bumps an existing copy suffix', () => {
    expect(incrementName('report copy.txt', false)).toBe('report copy 2.txt')
    expect(incrementName('report copy 2.txt', false)).toBe('report copy 3.txt')
  })
  test('treats a folder name whole (no extension split)', () => {
    expect(incrementName('assets.v2', true)).toBe('assets.v2 copy')
  })
})

describe('file-tree mutation locking', () => {
  test('an editor write waits for ownership of every ancestor below the workspace', async () => {
    const entered = deferred()
    const release = deferred()
    const folder = path.join(dir, 'folder')
    const target = path.join(folder, 'deep', 'note.txt')
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, 'before')
    const blocker = withPathLock(folder, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const write = writeFile(ctx(), 'u', 's1', target, 'after', contentHash('before'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readFileSync(target, 'utf8')).toBe('before')

    release.resolve()
    await Promise.all([blocker, write])
    expect(readFileSync(target, 'utf8')).toBe('after')
  })

  test('create waits for the parent namespace lock', async () => {
    const entered = deferred()
    const release = deferred()
    const parent = path.join(dir, 'parent')
    mkdirSync(parent)
    const blocker = withPathLock(parent, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const create = createEntry(ctx(), 'u', 's1', parent, 'new.txt', 'file')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(path.join(parent, 'new.txt'))).toBe(false)

    release.resolve()
    await Promise.all([blocker, create])
    expect(existsSync(path.join(parent, 'new.txt'))).toBe(true)
  })

  test('rename holds destination ownership and Undo queues behind its journal commit', async () => {
    const entered = deferred()
    const release = deferred()
    const source = path.join(dir, 'old.txt')
    const destination = path.join(dir, 'new.txt')
    writeFileSync(source, 'value')
    const blocker = withPathLock(destination, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const rename = renameEntry(ctx(), 'u', 's1', source, 'new.txt')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const undo = undoLastFileOp(ctx(), 'u', 's1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(source)).toBe(true)
    expect(existsSync(destination)).toBe(false)

    release.resolve()
    expect(await rename).toMatchObject({ path: destination })
    expect(await undo).toMatchObject({ undone: true, restoredPath: source })
    await blocker
    expect(existsSync(source)).toBe(true)
    expect(existsSync(destination)).toBe(false)
  })

  test('copy waits for both source and chosen destination ownership', async () => {
    const entered = deferred()
    const release = deferred()
    const source = path.join(dir, 'note.txt')
    const targetDir = path.join(dir, 'dest')
    const destination = path.join(targetDir, 'note.txt')
    writeFileSync(source, 'value')
    mkdirSync(targetDir)
    const blocker = withPathLock(destination, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const copy = pasteEntry(ctx(), 'u', 's1', source, targetDir, 'copy')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(destination)).toBe(false)

    release.resolve()
    await Promise.all([blocker, copy])
    expect(readFileSync(destination, 'utf8')).toBe('value')
  })

  test('trash deletion owns the shared bin before choosing a collision-free name', async () => {
    const entered = deferred()
    const release = deferred()
    const source = path.join(dir, 'note.txt')
    writeFileSync(source, 'value')
    const blocker = withPathLock(trash, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise

    const deletion = deleteEntry(ctx(), 'u', 's1', source)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(source)).toBe(true)

    release.resolve()
    await Promise.all([blocker, deletion])
    expect(existsSync(source)).toBe(false)
  })
})

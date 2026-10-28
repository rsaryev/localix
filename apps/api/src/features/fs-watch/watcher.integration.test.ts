import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createDirWatcher, foldChange, type DirWatcherHandle, type FsChange } from './watcher'

const handles: DirWatcherHandle[] = []
const dirs: string[] = []

afterEach(async () => {
  while (handles.length) handles.pop()?.close()
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {})
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fswatch-'))
  dirs.push(dir)
  return dir
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll until `done` holds or the deadline passes: real fs events arrive late on a busy machine. */
async function until(done: () => boolean, deadlineMs = 5_000): Promise<void> {
  const end = Date.now() + deadlineMs
  while (!done() && Date.now() < end) await sleep(25)
}

/**
 * Watch `root`, run `act`, and collect every directory reported until the watcher has been
 * quiet for a while. Collecting (instead of taking the first batch) is what lets a test say a
 * change was NEVER reported, not merely "not in the first flush".
 */
async function changedDirsAfter(root: string, act: () => Promise<void>): Promise<Set<string>> {
  const seen = new Set<string>()
  let error: unknown
  handles.push(
    createDirWatcher(root, (changed) => changed?.forEach((d) => seen.add(d)), {
      quietMs: 40,
      onError: (err) => (error = err),
    }),
  )
  // The native subscription is asynchronous; let it arm before acting.
  await sleep(150)
  await act()
  await sleep(500)
  if (error) throw error
  return seen
}

// A folder created and written into within one burst: inotify (Linux) adds its watch only after it
// has seen the folder appear, so the files written in that gap are never reported. FSEvents
// (macOS) is path-based and has no such gap. The first beta ships for macOS only, so the two
// burst cases below are macOS-only until the Linux watcher rescans a newly created folder.
const burstOfNewFolders = test.skipIf(process.platform === 'linux')

describe('createDirWatcher (real fs)', () => {
  test('reports the absolute parent directory of a created file', async () => {
    const root = await tempRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    const seen = await changedDirsAfter(root, () =>
      writeFile(path.join(root, 'src', 'new.ts'), 'export {}\n'),
    )
    expect(seen).toContain(path.join(root, 'src'))
  })

  // The regression: Bun's recursive fs.watch on macOS reported 3 of 14 changes in a burst like
  // this one, so files an agent or a terminal created stayed off the tree until a Refresh.
  burstOfNewFolders(
    'reports EVERY change of a burst, deletes and nested folders included',
    async () => {
      const root = await tempRoot()
      await writeFile(path.join(root, 'doomed.txt'), '1')
      const seen = await changedDirsAfter(root, async () => {
        await writeFile(path.join(root, 'a.txt'), '1')
        await writeFile(path.join(root, 'b.txt'), '1')
        await mkdir(path.join(root, 'src', 'deep'), { recursive: true })
        await writeFile(path.join(root, 'src', 'deep', 'x.ts'), '1')
        await rm(path.join(root, 'doomed.txt'))
      })
      for (const changed of ['a.txt', 'b.txt', 'src', 'src/deep', 'src/deep/x.ts', 'doomed.txt']) {
        expect(seen).toContain(path.join(root, changed))
      }
      expect(seen).toContain(root)
    },
  )

  // A plan is written to `.localix/plans/<ref>/PLAN.md`; the tree lists `.localix`, so a change
  // there must reach it like any other (the old ignore list dropped it).
  burstOfNewFolders(
    'reports changes under folders the tree shows, .localix and build output included',
    async () => {
      const root = await tempRoot()
      const seen = await changedDirsAfter(root, async () => {
        await mkdir(path.join(root, '.localix', 'plans', 'S-1'), { recursive: true })
        await writeFile(path.join(root, '.localix', 'plans', 'S-1', 'PLAN.md'), '# plan\n')
        await mkdir(path.join(root, 'dist'))
        await writeFile(path.join(root, 'dist', 'index.js'), '1\n')
      })
      expect(seen).toContain(root)
      expect(seen).toContain(path.join(root, '.localix', 'plans', 'S-1'))
      expect(seen).toContain(path.join(root, 'dist'))
    },
  )

  test('skips the inside of an installed package but not the package folder itself', async () => {
    const root = await tempRoot()
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    const seen = await changedDirsAfter(root, async () => {
      await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), '1\n')
      await mkdir(path.join(root, 'node_modules', 'added'))
    })
    const insidePackage = path.join(root, 'node_modules', 'pkg') + path.sep
    expect([...seen].filter((dir) => dir.startsWith(insidePackage))).toEqual([])
    expect(seen).toContain(path.join(root, 'node_modules', 'added'))
    expect(seen).toContain(path.join(root, 'node_modules'))
  })

  // FSEvents reports real paths; the tree is keyed by the root as the session knows it.
  test('maps changes under a symlinked root back onto that root', async () => {
    const real = await tempRoot()
    const parent = await tempRoot()
    const linked = path.join(parent, 'linked')
    await symlink(real, linked)
    const seen = await changedDirsAfter(linked, () =>
      writeFile(path.join(linked, 'note.md'), 'x\n'),
    )
    expect(seen).toContain(path.join(linked, 'note.md'))
    expect(seen).toContain(linked)
  })

  // A language server needs the ENTRIES with their kind, not the directories a tree re-lists.
  test('carries each changed entry with its create/update/delete type', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'edited.ts'), '1')
    await writeFile(path.join(root, 'doomed.ts'), '1')
    const seen = new Map<string, FsChange['type']>()
    handles.push(
      createDirWatcher(
        root,
        (_dirs, changes) => {
          for (const change of changes ?? []) seen.set(change.path, change.type)
        },
        { quietMs: 40 },
      ),
    )
    await sleep(150)
    await writeFile(path.join(root, 'created.ts'), '1')
    await writeFile(path.join(root, 'edited.ts'), '2')
    await rm(path.join(root, 'doomed.ts'))
    await until(() => seen.size >= 3)
    expect(seen.get(path.join(root, 'created.ts'))).toBe('create')
    expect(seen.get(path.join(root, 'edited.ts'))).toBe('update')
    expect(seen.get(path.join(root, 'doomed.ts'))).toBe('delete')
  })

  test('reports a root that cannot be watched to onError', async () => {
    const root = path.join(await tempRoot(), 'missing')
    const error = await new Promise<unknown>((resolve) => {
      handles.push(createDirWatcher(root, () => {}, { onError: resolve }))
      setTimeout(() => resolve(null), 2000)
    })
    expect(error).not.toBeNull()
  })
})

describe('foldChange — several events for one path in one flush', () => {
  // An editor's atomic save (write a temp file, rename it over) arrives as delete + create;
  // reporting `create` would tell a language server a file it already knows was new.
  test('delete then create is an update', () => {
    expect(foldChange('delete', 'create')).toBe('update')
  })
  test('create then update stays a create', () => {
    expect(foldChange('create', 'update')).toBe('create')
  })
  test('otherwise the latest event wins', () => {
    expect(foldChange('create', 'delete')).toBe('delete')
    expect(foldChange('update', 'delete')).toBe('delete')
    expect(foldChange(undefined, 'update')).toBe('update')
  })
})

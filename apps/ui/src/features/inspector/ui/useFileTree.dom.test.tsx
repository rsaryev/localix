import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { DirListing, FileEntryResponse } from '@/shared/api/contracts'
import { inspector } from '@/shared/lib/inspectorBus'
import { publishFsChange } from '@/shared/lib/fsChangeBus'
import { revealInTree } from '@/shared/lib/explorerBus'
import { registerDom } from '@localixai/kit/testing/dom'
import { useFileTree } from './useFileTree'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type TreeSnapshot = ReturnType<typeof useFileTree>

async function mountTree(initialSessionId: string) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let current: TreeSnapshot | null = null

  function SessionTree({ sessionId }: { sessionId: string }) {
    current = useFileTree(sessionId)
    return null
  }

  const render = (sessionId: string) =>
    act(async () => {
      root.render(<SessionTree key={sessionId} sessionId={sessionId} />)
      await Promise.resolve()
    })

  await render(initialSessionId)
  return {
    act,
    render,
    get current(): TreeSnapshot {
      if (!current) throw new Error('tree did not mount')
      return current
    },
    unmount: () => act(async () => root.unmount()),
  }
}

const listing = (path: string, names: string[] = []): DirListing => ({
  path,
  entries: names.map((name) => ({ name, type: name.includes('.') ? 'file' : 'dir' })),
})

describe('useFileTree async ownership', () => {
  test('remounts blank and drops an older session root response', async () => {
    const roots = {
      'session-a': deferred<DirListing>(),
      'session-b': deferred<DirListing>(),
    }
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (sessionId) => await roots[sessionId as keyof typeof roots].promise,
    )
    const tree = await mountTree('session-a')

    try {
      expect(tree.current.root).toBeNull()
      await tree.render('session-b')
      expect(tree.current.root).toBeNull()

      await tree.act(async () => {
        roots['session-b'].resolve(listing('/workspace-b', ['b.ts']))
        await roots['session-b'].promise
      })
      expect(tree.current.root).toBe('/workspace-b')

      await tree.act(async () => {
        roots['session-a'].resolve(listing('/workspace-a', ['a.ts']))
        await roots['session-a'].promise
      })
      expect(tree.current.root).toBe('/workspace-b')
      expect(tree.current.childrenByPath['/workspace-a']).toBeUndefined()
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  test('an epoch invalidation mid-load discards the older child-directory response', async () => {
    const child = deferred<DirListing>()
    const refresh = deferred<DirListing>()
    let rootReads = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (path) return await child.promise
        rootReads += 1
        return rootReads === 1 ? listing('/workspace', ['src']) : await refresh.promise
      },
    )
    const tree = await mountTree('session-a')

    try {
      let toggle!: Promise<void>
      await tree.act(async () => {
        toggle = tree.current.toggle('/workspace/src')
        await Promise.resolve()
      })
      await tree.act(async () => {
        tree.current.loadRoot()
        await Promise.resolve()
      })
      await tree.act(async () => {
        refresh.resolve(listing('/workspace', ['fresh.ts']))
        await refresh.promise
      })
      await tree.act(async () => {
        child.resolve(listing('/workspace/src', ['stale.ts']))
        await toggle
      })

      expect(tree.current.childrenByPath['/workspace']).toEqual([
        { name: 'fresh.ts', type: 'file' },
      ])
      expect(tree.current.childrenByPath['/workspace/src']).toBeUndefined()
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  test('a stale reload resolving after a newer reload cannot overwrite it', async () => {
    const older = deferred<DirListing>()
    const newer = deferred<DirListing>()
    let reloadReads = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (!path) return listing('/workspace', ['before.ts'])
        reloadReads += 1
        return await (reloadReads === 1 ? older.promise : newer.promise)
      },
    )
    const tree = await mountTree('session-a')

    try {
      let first!: Promise<boolean>
      let second!: Promise<boolean>
      await tree.act(async () => {
        first = tree.current.reloadDir('/workspace')
        second = tree.current.reloadDir('/workspace')
        await Promise.resolve()
      })
      await tree.act(async () => {
        newer.resolve(listing('/workspace', ['fresh.ts']))
        expect(await second).toBe(true)
      })
      await tree.act(async () => {
        older.resolve(listing('/workspace', ['stale.ts']))
        expect(await first).toBe(false)
      })

      expect(tree.current.childrenByPath['/workspace']).toEqual([
        { name: 'fresh.ts', type: 'file' },
      ])
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  test('joins overlapping expand and create reads for the same missing directory', async () => {
    const child = deferred<DirListing>()
    let childReads = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (!path) return listing('/workspace', ['src'])
        childReads += 1
        return await child.promise
      },
    )
    const tree = await mountTree('session-a')

    try {
      let first!: Promise<void>
      let create!: Promise<void>
      await tree.act(async () => {
        first = tree.current.toggle('/workspace/src')
        create = tree.current.startCreate('/workspace/src', 'file')
        await Promise.resolve()
      })

      expect(childReads).toBe(1)

      await tree.act(async () => {
        child.resolve(listing('/workspace/src', ['index.ts']))
        await Promise.all([first, create])
      })
      expect(tree.current.childrenByPath['/workspace/src']).toEqual([
        { name: 'index.ts', type: 'file' },
      ])
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  test('pasting into an unloaded folder reconciles it with one fresh directory read', async () => {
    let destinationReads = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (!path) return listing('/workspace', ['dest', 'source.ts'])
        if (path === '/workspace/dest') destinationReads += 1
        return listing(path, ['source.ts'])
      },
    )
    const paste = spyOn(backendClient, 'pasteFileEntry').mockResolvedValue({
      path: '/workspace/dest/source.ts',
      type: 'file',
    })
    const tree = await mountTree('session-a')

    try {
      await tree.act(async () => {
        await tree.current.dropEntries(['/workspace/source.ts'], '/workspace/dest', true)
      })

      expect(paste).toHaveBeenCalledWith(
        'session-a',
        '/workspace/source.ts',
        '/workspace/dest',
        'copy',
      )
      expect(destinationReads).toBe(1)
      expect(tree.current.childrenByPath['/workspace/dest']).toEqual([
        { name: 'source.ts', type: 'file' },
      ])
    } finally {
      await tree.unmount()
      paste.mockRestore()
      list.mockRestore()
    }
  })

  test('a batch drop reconciles its shared destination once after all mutations', async () => {
    let destinationReads = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (!path) return listing('/workspace', ['dest', 'a.ts', 'b.ts', 'c.ts'])
        if (path === '/workspace/dest') destinationReads += 1
        return listing(path, ['a.ts', 'b.ts', 'c.ts'])
      },
    )
    const paste = spyOn(backendClient, 'pasteFileEntry').mockResolvedValue({
      path: '/workspace/dest/copied.ts',
      type: 'file',
    })
    const tree = await mountTree('session-a')

    try {
      await tree.act(async () => {
        await tree.current.dropEntries(
          ['/workspace/a.ts', '/workspace/b.ts', '/workspace/c.ts'],
          '/workspace/dest',
          true,
        )
      })

      expect(paste).toHaveBeenCalledTimes(3)
      expect(destinationReads).toBe(1)
    } finally {
      await tree.unmount()
      paste.mockRestore()
      list.mockRestore()
    }
  })

  test('a create completed after a session switch cannot open in the new workspace', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(async (sessionId) =>
      listing(sessionId === 'session-a' ? '/workspace-a' : '/workspace-b'),
    )
    const created = deferred<FileEntryResponse>()
    const create = spyOn(backendClient, 'createFileEntry').mockImplementation(
      async () => await created.promise,
    )
    const open = spyOn(inspector, 'openFile')
    const tree = await mountTree('session-a')

    try {
      await tree.act(async () => {
        await tree.current.startCreate('/workspace-a', 'file')
      })
      let submit!: Promise<void>
      await tree.act(async () => {
        submit = tree.current.submitEdit('new.ts')
        await Promise.resolve()
      })

      await tree.render('session-b')
      await tree.act(async () => {
        created.resolve({ path: '/workspace-a/new.ts', type: 'file' })
        await submit
      })

      expect(tree.current.root).toBe('/workspace-b')
      expect(open).not.toHaveBeenCalled()
    } finally {
      await tree.unmount()
      open.mockRestore()
      create.mockRestore()
      list.mockRestore()
    }
  })

  test('a rename rejected for a sibling collision stays open with the validation error', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockResolvedValue(
      listing('/workspace', ['source.ts', 'taken.ts']),
    )
    const rename = spyOn(backendClient, 'renameFileEntry').mockImplementation(
      async (_sessionId, path, value) => {
        if (value === 'taken.ts') throw new Error('An entry named “taken.ts” already exists')
        // The real client resolves to the renamed entry; returning it keeps the mock
        // type-faithful, which `bun test` alone does not check (the apps/ui build does).
        return { path: `${path.replace(/[^/]+$/u, '')}${value}`, type: 'file' as const }
      },
    )
    const tree = await mountTree('session-a')

    try {
      await tree.act(async () => {
        tree.current.startRename({ name: 'source.ts', type: 'file' }, '/workspace')
      })
      await tree.act(async () => {
        await tree.current.submitEdit('taken.ts')
      })

      expect(rename).toHaveBeenCalledWith('session-a', '/workspace/source.ts', 'taken.ts')
      expect(tree.current.edit).toEqual({
        mode: 'rename',
        path: '/workspace/source.ts',
        parentPath: '/workspace',
        name: 'source.ts',
        kind: 'file',
      })
      expect(tree.current.editError).toBe('An entry named “taken.ts” already exists')
    } finally {
      await tree.unmount()
      rename.mockRestore()
      list.mockRestore()
    }
  })

  test('joins overlapping undo requests so one gesture reverses one operation', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockResolvedValue(listing('/workspace'))
    const undone = deferred<{ undone: boolean }>()
    const undo = spyOn(backendClient, 'undoFileOp').mockImplementation(
      async () => await undone.promise,
    )
    const tree = await mountTree('session-a')

    try {
      let first!: Promise<void>
      let duplicate!: Promise<void>
      await tree.act(async () => {
        first = tree.current.undoLast()
        duplicate = tree.current.undoLast()
        await Promise.resolve()
      })
      expect(duplicate).toBe(first)
      expect(undo).toHaveBeenCalledTimes(1)

      await tree.act(async () => {
        undone.resolve({ undone: false })
        await first
      })
    } finally {
      await tree.unmount()
      undo.mockRestore()
      list.mockRestore()
    }
  })

  test('reveals an unmounted file through a semantic virtual-scroll request', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(
      async (_sessionId, path) => {
        if (!path) return listing('/workspace', ['src'])
        if (path === '/workspace/src') return listing(path, ['lib'])
        if (path === '/workspace/src/lib') return listing(path, ['target.ts'])
        return listing(path)
      },
    )
    const tree = await mountTree('session-a')

    try {
      await tree.act(async () => {
        revealInTree('/workspace/src/lib/target.ts')
        await Promise.resolve()
        await Promise.resolve()
      })

      // Compact folders expand only the folded chain tail; the target still
      // becomes visible without forcing every intermediate breadcrumb open.
      expect(tree.current.expanded.has('/workspace/src/lib')).toBe(true)
      expect(tree.current.revealRequest?.path).toBe('/workspace/src/lib/target.ts')
      const firstIntent = tree.current.revealRequest?.intent

      // Explicit reveal of the already-active path must still re-scroll.
      await tree.act(async () => {
        revealInTree('/workspace/src/lib/target.ts')
        await Promise.resolve()
      })
      expect(tree.current.revealRequest?.intent).toBeGreaterThan(firstIntent ?? 0)
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  test('a coarse fs frame refreshes every loaded dir without a stampede', async () => {
    const FOLDERS = 30
    const names = Array.from({ length: FOLDERS }, (_, i) => `dir-${i}`)
    let active = 0
    let peak = 0
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(async (_s, path) => {
      active++
      peak = Math.max(peak, active)
      // Hold the read open across a macrotask so overlap is observable.
      await new Promise((r) => setTimeout(r, 1))
      active--
      return listing(path ?? '/workspace', [])
    })
    const tree = await mountTree('session-fan')

    try {
      await tree.act(async () => {
        tree.current.loadRoot()
        await Promise.resolve()
      })
      // Seed the tree with the folder list, then expand every folder so each one
      // becomes a LOADED directory the coarse frame has to refresh.
      list.mockImplementation(async (_s, path) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 1))
        active--
        return listing(path ?? '/workspace', path === '/workspace' ? names : [])
      })
      await tree.act(async () => {
        await tree.current.reloadDir('/workspace')
      })
      for (const name of names) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- expanding in parallel races the tree's own read tokens
        await tree.act(async () => {
          await tree.current.toggle(`/workspace/${name}`)
        })
      }
      expect(Object.keys(tree.current.childrenByPath).length).toBe(FOLDERS + 1)

      peak = 0
      const before = list.mock.calls.length
      await tree.act(async () => {
        // Empty paths IS the coarse "reload everything visible" frame.
        publishFsChange({ sessionId: 'session-fan', paths: [] })
        await new Promise((r) => setTimeout(r, 400))
      })

      const issued = list.mock.calls.length - before
      // Every loaded directory is still refreshed — the cap delays work, never drops it.
      expect(issued).toBe(FOLDERS + 1)
      // …but never more than a handful of server reads are in flight together.
      expect(peak).toBeLessThanOrEqual(6)
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })

  /**
   * The refresh queue and a mutation the person just made both land in `reloadDir`, and they do not
   * deserve the same treatment: a watch-driven read that fails during churn is noise the next frame
   * fixes, while a folder that silently keeps its pre-rename contents is the tree lying about an
   * action someone took on purpose.
   */
  test('reports a failed refresh the person asked for, and stays quiet for the watcher', async () => {
    const { toast } = await import('@/shared/lib/notify')
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(async (_s, path) => {
      if (!path) return listing('/workspace', ['src'])
      throw new Error('EIO: i/o error, scandir')
    })
    const errors = spyOn(toast, 'error').mockImplementation(() => '')
    const tree = await mountTree('session-quiet')

    try {
      await tree.act(async () => {
        expect(await tree.current.reloadDir('/workspace')).toBe(false)
      })
      expect(errors.mock.calls.length).toBe(1)
      expect(JSON.stringify(errors.mock.calls[0]?.[0])).toContain('workspace')

      errors.mockClear()
      await tree.act(async () => {
        publishFsChange({ sessionId: 'session-quiet', paths: ['/workspace'] })
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      expect(list.mock.calls.length).toBeGreaterThan(1)
      expect(errors.mock.calls.length).toBe(0)
    } finally {
      await tree.unmount()
      errors.mockRestore()
      list.mockRestore()
    }
  })
})

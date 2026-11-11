import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import type { DirListing } from '@/shared/api/contracts'
import { ApiError } from '@/shared/api/failure'
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
afterEach(() => mock.restore())

const gone = () =>
  new ApiError('Project folder not found: /w/kit', 409, 'workspace_folder_missing', '/w/kit')
const listing = (names: string[]): DirListing => ({
  path: '/w/kit',
  entries: names.map((name) => ({ name, type: 'file' })),
})

async function mountTree() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let current: ReturnType<typeof useFileTree> | null = null
  function Tree() {
    const value = useFileTree('gone-tree', { refreshDelayMs: 0 })
    React.useEffect(() => {
      current = value
    })
    return null
  }
  await React.act(async () => {
    root.render(<Tree />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    act: React.act,
    get current() {
      if (!current) throw new Error('tree did not mount')
      return current
    },
    unmount: () => React.act(async () => root.unmount()),
  }
}

// A folder renamed away is not "a failure to read the folder": the pane shows the way back
// (MissingFolderNotice) instead of a red problem line, and a reload once it is fixed clears it.
describe('the tree of a project whose folder is gone', () => {
  test('a gone folder is reported as such, not as a problem, and clears once it is back', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockRejectedValue(gone())
    const tree = await mountTree()
    try {
      expect(tree.current.folderGone).toBe(true)
      expect(tree.current.problem).toBeNull()

      list.mockResolvedValue(listing(['README.md']))
      await tree.act(async () => {
        tree.current.loadRoot()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(tree.current.folderGone).toBe(false)
      expect(tree.current.root).toBe('/w/kit')
      expect(tree.current.childrenByPath['/w/kit']?.map((e) => e.name)).toEqual(['README.md'])
    } finally {
      await tree.unmount()
    }
  })

  test('the folder going away under a loaded tree turns the pane over on the next re-list', async () => {
    const list = spyOn(backendClient, 'listDirectory').mockResolvedValue(listing(['a.txt']))
    const tree = await mountTree()
    try {
      expect(tree.current.folderGone).toBe(false)
      list.mockRejectedValue(gone())
      await tree.act(async () => {
        await tree.current.reloadDir('', { quiet: true })
      })
      expect(tree.current.folderGone).toBe(true)
    } finally {
      await tree.unmount()
    }
  })

  test('any other failure stays a problem line', async () => {
    spyOn(backendClient, 'listDirectory').mockRejectedValue(new ApiError('boom', 500, 'internal'))
    const tree = await mountTree()
    try {
      expect(tree.current.folderGone).toBe(false)
      expect(tree.current.problem).not.toBeNull()
    } finally {
      await tree.unmount()
    }
  })
})

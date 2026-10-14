import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { DirListing } from '@/shared/api/contracts'
import { eventSocket } from '@/shared/api/eventSocket'
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

async function mountTree(sessionId: string) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let current: ReturnType<typeof useFileTree> | null = null
  function Tree() {
    current = useFileTree(sessionId)
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

const listing = (path: string, names: string[], live: boolean): DirListing => ({
  path,
  entries: names.map((name) => ({ name, type: 'dir' as const })),
  live,
})

describe('the live tree', () => {
  // `fs.changed` is live-only and a server restart takes its watcher with it: without this, what
  // changed during the outage stays off the tree until someone presses a Refresh that is gone.
  test('a reconnect re-reads every loaded directory', async () => {
    let reconnect: (() => void) | undefined
    const onReconnect = spyOn(eventSocket, 'onReconnect').mockImplementation((handler) => {
      reconnect = handler as () => void
      return () => {}
    })
    const watch = spyOn(eventSocket, 'watchSession').mockImplementation(() => () => {})
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(async (_s, path) =>
      listing(path ?? '/ws', path ? [] : ['src'], true),
    )
    const tree = await mountTree('session-reconnect')
    try {
      await tree.act(async () => {
        await tree.current.toggle('/ws/src')
      })
      const before = list.mock.calls.length
      await tree.act(async () => {
        reconnect?.()
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      const reread = list.mock.calls.slice(before).map(([, path]) => path)
      expect(reread.sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['/ws', '/ws/src'])
      // The tree declares the session it renders, so its frames reach this connection.
      expect(watch).toHaveBeenCalledWith('session-reconnect')
    } finally {
      await tree.unmount()
      list.mockRestore()
      watch.mockRestore()
      onReconnect.mockRestore()
    }
  })

  test('follows what each listing says about being live', async () => {
    let live = true
    const list = spyOn(backendClient, 'listDirectory').mockImplementation(async (_s, path) =>
      listing(path ?? '/ws', [], live),
    )
    const tree = await mountTree('session-live')
    try {
      expect(tree.current.live).toBe(true)
      // A watcher failure sends a coarse frame; the re-list it causes reports the backoff.
      live = false
      await tree.act(async () => {
        await tree.current.reloadDir('/ws')
      })
      expect(tree.current.live).toBe(false)
    } finally {
      await tree.unmount()
      list.mockRestore()
    }
  })
})

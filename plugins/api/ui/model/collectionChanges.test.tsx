import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { bindPluginUiRuntime, type PluginUiRuntime } from '@localixai/plugin-sdk/ui/runtime'
import { registerDom } from '@localixai/kit/testing'
import { COLLECTION_DIR } from '../../backend/collection/paths'
import { COLLECTION_SEGMENTS, touchesCollection } from './collectionChanges'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

describe('which workspace changes move the collection', () => {
  test('the browser’s folder is the backend’s', () => {
    expect(path.join(...COLLECTION_SEGMENTS)).toBe(COLLECTION_DIR)
  })

  test('a file at or under the collection folder does; a neighbour or another file does not', () => {
    const root = '/work/project'
    expect(touchesCollection({ paths: [`${root}/.localix/api/users/list.request.json`] })).toBe(
      true,
    )
    expect(touchesCollection({ paths: [`${root}/.localix/api`] })).toBe(true)
    expect(touchesCollection({ paths: ['C:\\work\\.localix\\api\\environments\\dev.json'] })).toBe(
      true,
    )
    expect(touchesCollection({ paths: [`${root}/.localix/api-old/x.json`] })).toBe(false)
    expect(touchesCollection({ paths: [`${root}/.localix/plans/a.md`, `${root}/src/a.ts`] })).toBe(
      false,
    )
  })

  test('a coarse change — too many paths to list, or a restart — may have moved it', () => {
    expect(touchesCollection({ paths: null })).toBe(true)
  })
})

/**
 * The sidebar polled every 15 s for a collection file the agent rewrote on disk, because no call
 * announced it. The workspace watcher does: such a change re-reads at once, another file does not,
 * and the hook says the signal is live so the poll can fall back to its backstop.
 */
test('a collection file changed on disk re-reads; any other file does not', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useCollectionChanges } = await import('./collectionChanges')
  let emit: (paths: string[] | null) => void = () => {}
  const unbind = bindPluginUiRuntime({
    files: {
      watchWorkspace: (
        _sessionId: string,
        handlers: { onChange: (paths: string[] | null) => void; onLive: (live: boolean) => void },
      ) => {
        emit = handlers.onChange
        handlers.onLive(true)
        return () => {}
      },
    },
  } as unknown as PluginUiRuntime)
  let reads = 0
  let live = null as boolean | null
  function Probe() {
    live = useCollectionChanges('chat-1', () => {
      reads += 1
    })
    return null
  }
  const element = document.createElement('div')
  const root = createRoot(element)
  try {
    await act(async () => root.render(<Probe />))
    expect(live).toBe(true)
    await act(async () => {
      emit(['/w/src/index.ts'])
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(reads).toBe(0)
    await act(async () => {
      emit(['/w/.localix/api/users/list.request.json'])
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(reads).toBe(1)
  } finally {
    await act(async () => root.unmount())
    unbind()
  }
})

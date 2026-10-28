import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { MiniAppToast, MiniAppToastOptions } from '@localixai/mini-app-sdk/ui'
import type { useSourceControlStore as SourceControlStore } from './source-control/model/store'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

/**
 * What the git ops write to the Event Center, pinned.
 *
 * Every `toast.*` call is a DURABLE row, so the defects here were rows: a raw "Push failed" title
 * whose body was git's stderr, a success row for a result the panel already shows, and two rows for
 * one detached checkout.
 */

interface Row {
  kind: string
  title: string
  options?: MiniAppToastOptions
}
const rows: Row[] = []

let teardown: () => Promise<void>
let realStore: ReturnType<typeof SourceControlStore.getState> | undefined
beforeAll(async () => {
  realStore = (await import('./source-control/model/store')).useSourceControlStore.getState()
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const { bindMiniAppUiToast } = await import('@localixai/mini-app-sdk/ui')
  const method = (kind: string) => (title: string, options?: MiniAppToastOptions) => {
    rows.push({ kind, title, options })
    return rows.length
  }
  bindMiniAppUiToast(
    Object.assign(method('message'), {
      success: method('success'),
      error: method('error'),
      info: method('info'),
      warning: method('warning'),
      message: method('message'),
      problems: () => undefined,
      problemsCleared: () => {},
    }) as MiniAppToast,
  )
})
// Bun runs every test file in one process: a probe left mounted, or a spy left in place, keeps
// calling the API from under the next file's assertions.
const unmounts: (() => void)[] = []
afterEach(async () => {
  const { act } = await import('react')
  act(() => {
    for (const unmount of unmounts.splice(0)) unmount()
  })
  mock.restore()
  // The tests swap store ACTIONS; put the real ones back for the files that run after this one.
  const { useSourceControlStore } = await import('./source-control/model/store')
  useSourceControlStore.setState(realStore!, true)
  rows.length = 0
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => turns()

/** Mount a hook and hand back a live view of what it returned on the latest render. */
async function mountHook<T>(useHook: () => T): Promise<{ current: () => T }> {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let latest: T | undefined
  function Probe() {
    const value = useHook()
    React.useEffect(() => {
      latest = value
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  unmounts.push(() => root.unmount())
  await React.act(async () => {
    root.render(<Probe />)
    await settle()
  })
  return { current: () => latest as T }
}

describe('Event Center rows written by the git ops', () => {
  test('a failed push is titled by the button, with git’s words as the detail', async () => {
    const { act } = await import('react')
    const { useSourceControlStore } = await import('./source-control/model/store')
    const { useGitPanelOps } = await import('./source-control/model/useGitPanelOps')
    const { sourceControlApi } = await import('./api')
    spyOn(sourceControlApi, 'getHeadCommitMessage').mockResolvedValue(null)
    spyOn(sourceControlApi, 'getRecentCommitMessages').mockResolvedValue([])
    useSourceControlStore.setState({
      push: () => Promise.reject(new Error('fatal: unable to access remote')),
      pull: () => Promise.resolve(),
    })
    const ops = await mountHook(() => useGitPanelOps('session-1', '/repo'))

    await act(() => ops.current().push())
    expect(rows).toEqual([
      {
        kind: 'error',
        title: 'Could not push',
        options: { description: 'fatal: unable to access remote' },
      },
    ])

    // A pull that worked posts nothing: the header's "Pull N" button disappearing is the answer.
    rows.length = 0
    await act(() => ops.current().pull())
    expect(rows).toEqual([])
  })

  test('a detached checkout is ONE row, not a success and an info for the same click', async () => {
    const { act } = await import('react')
    const { useSourceControlStore } = await import('./source-control/model/store')
    const { useCommitGraphOps } = await import('./source-control/model/useCommitGraphOps')
    useSourceControlStore.setState({ checkoutCommit: () => Promise.resolve() })
    const ops = await mountHook(() => useCommitGraphOps('session-1', 'main', () => {}))

    await act(async () => {
      ops.current().doCheckout({ hash: 'abcdef123', shortHash: 'abcdef1' } as never)
      await settle()
    })
    expect(rows.map((row) => [row.kind, row.title])).toEqual([
      ['info', 'HEAD is now detached at abcdef1'],
    ])
  })
})

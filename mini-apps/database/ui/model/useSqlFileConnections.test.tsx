import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import type { DbConnectionInfo } from '../dbClient'
import type { SqlFileConnectionsState } from './useSqlFileConnections'

let teardown: () => Promise<void>
let restoreRealtime: () => void
beforeAll(() => {
  teardown = registerDom()
  const realtime = [
    spyOn(miniAppRealtime, 'onFrame').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onReconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onDisconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'request').mockResolvedValue(undefined),
  ]
  restoreRealtime = () => realtime.forEach((method) => method.mockRestore())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// The list is process-wide now; each case starts from a process that has never listed.
beforeEach(async () => (await import('./connectionsStore')).resetConnectionsStore())
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  restoreRealtime()
  await teardown()
})

function connection(id: string): DbConnectionInfo {
  return {
    id,
    name: id,
    dialect: 'sqlite',
    connected: true,
    readonly: false,
    createdAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useSqlFileConnections list ownership', () => {
  test('a parked SQL file waits to list and does not refresh on window focus', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { databaseApi } = await import('../api/databaseApi')
    const { useSqlFileConnections } = await import('./useSqlFileConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => {
      calls += 1
      return []
    }

    function Harness({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Reader />
        </WorkItemVisibilityProvider>
      )
    }
    function Reader() {
      useSqlFileConnections()
      return null
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => {
        root.render(<Harness visible={false} />)
        await settle()
      })
      expect(calls).toBe(0)

      await act(async () => {
        root.render(<Harness visible />)
        await settle()
      })
      expect(calls).toBe(1)

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await settle()
      })
      expect(calls).toBe(2)

      await act(async () => root.render(<Harness visible={false} />))
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await settle()
      })
      expect(calls).toBe(2)

      // Showing the tab again reuses the shared list: a visibility flip is not a change.
      await act(async () => {
        root.render(<Harness visible />)
        await settle()
      })
      expect(calls).toBe(2)
    } finally {
      await act(async () => root.unmount())
      databaseApi.list = originalList
    }
  })

  test('development StrictMode starts one initial list request', async () => {
    const React = await import('react')
    const { StrictMode, act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useSqlFileConnections } = await import('./useSqlFileConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => {
      calls += 1
      return []
    }

    function Harness() {
      useSqlFileConnections()
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <Harness />
          </StrictMode>,
        )
      })
      expect(calls).toBe(1)
    } finally {
      await act(async () => {
        root.unmount()
      })
      databaseApi.list = originalList
    }
  })

  test('refreshes during a read coalesce into one trailing read, whose answer wins', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useSqlFileConnections } = await import('./useSqlFileConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    const initial = deferred<DbConnectionInfo[]>()
    const older = deferred<DbConnectionInfo[]>()
    const newer = deferred<DbConnectionInfo[]>()
    const reads = [initial, older, newer]
    databaseApi.list = () => {
      const read = reads.shift()
      if (!read) throw new Error('Unexpected list request')
      return read.promise
    }

    let state: SqlFileConnectionsState | undefined
    function Harness() {
      const latest = useSqlFileConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => {
        root.render(<Harness />)
      })
      await act(async () => {
        initial.resolve([])
        await initial.promise
      })

      // The second refresh lands while the first read runs: it may have been answered before
      // the change being asked about, so exactly one more read follows it — never two.
      await act(async () => {
        state?.refresh()
        state?.refresh()
        state?.refresh()
      })
      await act(async () => {
        older.resolve([connection('older')])
        await older.promise
      })
      await act(async () => {
        newer.resolve([connection('newer')])
        await newer.promise
      })

      expect(reads).toEqual([])
      expect(state?.live.map(({ id }) => id)).toEqual(['newer'])
      expect(state?.active?.id).toBe('newer')
      expect(state?.loading).toBe(false)
    } finally {
      await act(async () => {
        root.unmount()
      })
      databaseApi.list = originalList
    }
  })
})

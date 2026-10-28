import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import type { DbConnectionInfo } from '../dbClient'
import type { DbConnectionsState } from './useDbConnections'

let teardown: () => Promise<void>
let restoreRealtime: () => void
beforeAll(() => {
  teardown = registerDom()
  // List and invalidation tests drive their own reads, without a host websocket.
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
    connected: false,
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

describe('useDbConnections list ownership', () => {
  test('a parked database work item waits to list connections until it becomes visible', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')

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
      useDbConnections()
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

      // Hiding and re-showing the tab is not a change to the list: it used to re-list on
      // every flip, once per mounted surface.
      await act(async () => root.render(<Harness visible={false} />))
      await act(async () => {
        root.render(<Harness visible />)
        await settle()
      })
      expect(calls).toBe(1)
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
    const { useDbConnections } = await import('./useDbConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => {
      calls += 1
      return []
    }

    function Harness() {
      useDbConnections()
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

  test('a refresh during a read is answered by one trailing read, not by the stale one', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')

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

    let state: DbConnectionsState | undefined
    function Harness() {
      const latest = useDbConnections()
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

      await act(async () => {
        state?.refreshList()
        state?.refreshList()
      })
      await act(async () => {
        older.resolve([connection('older')])
        await older.promise
      })
      // Still loading: the trailing read owes an answer the first one may not reflect.
      expect(state?.loading).toBe(true)
      await act(async () => {
        newer.resolve([connection('newer')])
        await newer.promise
      })

      expect(reads).toEqual([])
      expect(state?.connections.map(({ id }) => id)).toEqual(['newer'])
      expect(state?.loading).toBe(false)
      expect(state?.listError).toBeNull()
    } finally {
      await act(async () => {
        root.unmount()
      })
      databaseApi.list = originalList
    }
  })

  test('keeps the backend’s own words behind the sentence it shows', async () => {
    // The half that used to be dropped: `DbApiError` carries the driver's exact text in `detail`,
    // and a state that stored only `err.message` left the Event Center with nothing to show an
    // operator. A failure that is NOT a typed API error is classified instead, its raw text kept.
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi, DbApiError } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    let state: DbConnectionsState | undefined
    function Harness() {
      const latest = useDbConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    databaseApi.list = () =>
      Promise.reject(
        new DbApiError('Could not read your saved connections.', undefined, 'SQLITE_BUSY'),
      )
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => {})
      expect(state?.listError).toEqual({
        message: 'Could not read your saved connections.',
        detail: 'SQLITE_BUSY',
      })

      databaseApi.list = () => Promise.reject(new TypeError('Failed to fetch'))
      await act(async () => {
        state?.refreshList()
      })
      await act(async () => {})
      // A fetch that never left the browser is not a sentence about saved connections.
      expect(state?.listError).toEqual({
        message: 'Could not load your saved connections.',
        detail: 'Failed to fetch',
      })
    } finally {
      await act(async () => {
        root.unmount()
      })
      databaseApi.list = originalList
    }
  })

  test('a stale list snapshot cannot resurrect a connection removed during refresh', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')

    const originalList = databaseApi.list.bind(databaseApi)
    const originalRemove = databaseApi.remove.bind(databaseApi)
    const refresh = deferred<DbConnectionInfo[]>()
    let listCalls = 0
    databaseApi.list = () => {
      listCalls += 1
      return listCalls === 1 ? Promise.resolve([connection('removed')]) : refresh.promise
    }
    databaseApi.remove = async () => {}

    let state: DbConnectionsState | undefined
    function Harness() {
      const latest = useDbConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      expect(state?.connections.map(({ id }) => id)).toEqual(['removed'])

      await act(async () => {
        state!.refreshList()
        await state!.remove('removed')
        refresh.resolve([connection('removed')])
        await refresh.promise
      })

      expect(state?.connections).toEqual([])
      expect(state?.loading).toBe(false)
    } finally {
      await act(async () => root.unmount())
      databaseApi.list = originalList
      databaseApi.remove = originalRemove
    }
  })

  test('shares one reconnect result with every concurrent caller', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')
    const originalList = databaseApi.list.bind(databaseApi)
    const originalReconnect = databaseApi.reconnect.bind(databaseApi)
    const reconnect = deferred<DbConnectionInfo>()
    let calls = 0
    databaseApi.list = async () => [connection('shared')]
    databaseApi.reconnect = () => {
      calls += 1
      return reconnect.promise
    }
    let state: DbConnectionsState | undefined

    function Harness() {
      const latest = useDbConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      let first!: Promise<DbConnectionInfo | undefined>
      let second!: Promise<DbConnectionInfo | undefined>
      await act(async () => {
        first = state!.ensureConnected('shared')
        second = state!.ensureConnected('shared')
        reconnect.resolve({ ...connection('shared'), connected: true })
        await Promise.all([first, second])
      })

      expect(calls).toBe(1)
      expect(await first).toEqual({ ...connection('shared'), connected: true })
      expect(await second).toEqual({ ...connection('shared'), connected: true })
      expect(state!.connections[0]?.connected).toBe(true)
      expect(state!.reconnecting.shared).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      databaseApi.list = originalList
      databaseApi.reconnect = originalReconnect
    }
  })

  test('reconnects a prototype-named id instead of reading inherited state', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')
    const originalList = databaseApi.list.bind(databaseApi)
    const originalReconnect = databaseApi.reconnect.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => [connection('__proto__')]
    databaseApi.reconnect = async () => {
      calls += 1
      return { ...connection('__proto__'), connected: true }
    }
    let state: DbConnectionsState | undefined

    function Harness() {
      const latest = useDbConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      expect(state!.reconnecting['__proto__']).toBeUndefined()
      expect(state!.reconnectError['__proto__']).toBeUndefined()

      let result: DbConnectionInfo | undefined
      await act(async () => {
        result = await state!.ensureConnected('__proto__')
      })

      expect(calls).toBe(1)
      expect(result?.connected).toBe(true)
      expect(state!.connections[0]?.connected).toBe(true)
      expect(state!.reconnecting['__proto__']).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      databaseApi.list = originalList
      databaseApi.reconnect = originalReconnect
    }
  })

  test('does not resurrect a disconnected row from a late reconnect response', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useDbConnections } = await import('./useDbConnections')
    const originalList = databaseApi.list.bind(databaseApi)
    const originalReconnect = databaseApi.reconnect.bind(databaseApi)
    const originalDisconnect = databaseApi.disconnect.bind(databaseApi)
    const reconnect = deferred<DbConnectionInfo>()
    databaseApi.list = async () => [connection('late')]
    databaseApi.reconnect = () => reconnect.promise
    databaseApi.disconnect = async () => {}
    let state: DbConnectionsState | undefined

    function Harness() {
      const latest = useDbConnections()
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      let pending!: Promise<DbConnectionInfo | undefined>
      await act(async () => {
        pending = state!.ensureConnected('late')
        await Promise.resolve()
      })
      await act(async () => {
        await state!.disconnect('late')
        reconnect.resolve({ ...connection('late'), connected: true })
        await pending
      })

      expect(await pending).toBeUndefined()
      expect(state!.connections[0]?.connected).toBe(false)
      expect(state!.reconnecting.late).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      databaseApi.list = originalList
      databaseApi.reconnect = originalReconnect
      databaseApi.disconnect = originalDisconnect
    }
  })
})

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionInfo } from '../dbClient'
import type { DbConnectionsState } from './useDbConnections'
import type { SqlFileConnectionsState } from './useSqlFileConnections'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(async () => (await import('./connectionsStore')).resetConnectionsStore())
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const connection = (id: string, connected = true): DbConnectionInfo => ({
  id,
  name: id,
  dialect: 'sqlite',
  connected,
  readonly: false,
  createdAt: 1,
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function mountReaders() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
  const { useDbConnections } = await import('./useDbConnections')
  const { useSqlFileConnections } = await import('./useSqlFileConnections')
  const { useDatabaseStatusItem } = await import('../statusItem')
  const { bindMiniAppUiRuntime } = await import('@localixai/mini-app-sdk/ui/runtime')
  type Runtime = Parameters<typeof bindMiniAppUiRuntime>[0]
  // The titlebar item reads which work item is focused; nothing is, in this harness.
  const workspaceSnapshot = { focusedId: null, items: {} }
  const unbind = bindMiniAppUiRuntime({
    workspace: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} },
  } as unknown as Runtime)

  const seen: {
    workspace?: DbConnectionsState
    tab?: DbConnectionsState
    sqlFile?: SqlFileConnectionsState
    status?: ReturnType<typeof useDatabaseStatusItem>
  } = {}
  function Workspace() {
    const workspace = useDbConnections()
    React.useEffect(() => {
      seen.workspace = workspace
    })
    return null
  }
  function ConnectionTab() {
    const tab = useDbConnections()
    React.useEffect(() => {
      seen.tab = tab
    })
    return null
  }
  function SqlFile() {
    const sqlFile = useSqlFileConnections()
    React.useEffect(() => {
      seen.sqlFile = sqlFile
    })
    return null
  }
  function Titlebar() {
    const status = useDatabaseStatusItem('chat-a')
    React.useEffect(() => {
      seen.status = status
    })
    return null
  }
  function Harness({ visible }: { visible: boolean }) {
    return (
      <>
        <Titlebar />
        <WorkItemVisibilityProvider visible={visible}>
          <Workspace />
          <ConnectionTab />
          <SqlFile />
          <SqlFile />
        </WorkItemVisibilityProvider>
      </>
    )
  }
  const root = createRoot(document.createElement('div'))
  const render = (visible: boolean) =>
    act(async () => {
      root.render(<Harness visible={visible} />)
      await settle()
    })
  const unmount = async () => {
    await act(async () => root.unmount())
    unbind()
  }
  return { act, seen, render, unmount }
}

describe('connectionsStore — one list for every reader', () => {
  test('N mounted readers, visibility flips and focus cost exactly one list request', async () => {
    const { databaseApi } = await import('../api/databaseApi')
    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    let release!: (rows: DbConnectionInfo[]) => void
    databaseApi.list = () => {
      calls += 1
      return new Promise((resolve) => (release = resolve))
    }
    const readers = await mountReaders()
    try {
      await readers.render(true)
      // Focus while the read runs JOINS it; flipping visibility reuses it.
      await readers.act(async () => window.dispatchEvent(new Event('focus')))
      await readers.render(false)
      await readers.render(true)
      await readers.act(async () => {
        release([connection('shared')])
        await settle()
      })

      expect(calls).toBe(1)
      expect(readers.seen.workspace?.connections.map(({ id }) => id)).toEqual(['shared'])
      expect(readers.seen.tab?.connections.map(({ id }) => id)).toEqual(['shared'])
      expect(readers.seen.sqlFile?.active?.id).toBe('shared')
      expect(readers.seen.status?.text).toBe('shared')
    } finally {
      await readers.unmount()
      databaseApi.list = originalList
    }
  })

  test('a mutation through one reader is on every other reader at once', async () => {
    const { databaseApi } = await import('../api/databaseApi')
    const originalList = databaseApi.list.bind(databaseApi)
    const originalRename = databaseApi.rename.bind(databaseApi)
    const originalDisconnect = databaseApi.disconnect.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => {
      calls += 1
      return [connection('a')]
    }
    databaseApi.rename = async (id, name) => ({ ...connection(id), name })
    databaseApi.disconnect = async () => {}
    const readers = await mountReaders()
    try {
      await readers.render(true)
      await readers.act(async () => {
        await readers.seen.workspace!.rename('a', 'Analytics')
      })
      expect(readers.seen.tab?.connections[0]?.name).toBe('Analytics')
      expect(readers.seen.sqlFile?.active?.name).toBe('Analytics')
      expect(readers.seen.status?.text).toBe('Analytics')

      await readers.act(async () => {
        await readers.seen.tab!.disconnect('a')
      })
      expect(readers.seen.workspace?.connections[0]?.connected).toBe(false)
      expect(readers.seen.sqlFile?.active).toBeNull()
      // Written in place: neither mutation needed a re-list to reach the other readers.
      expect(calls).toBe(1)
    } finally {
      await readers.unmount()
      databaseApi.list = originalList
      databaseApi.rename = originalRename
      databaseApi.disconnect = originalDisconnect
    }
  })

  test('a connection the agent added server-side reaches a polling reader, quietly and once', async () => {
    const { databaseApi } = await import('../api/databaseApi')
    const store = await import('./connectionsStore')
    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    let rows = [connection('mine')]
    databaseApi.list = async () => {
      calls += 1
      return rows
    }
    try {
      // Nobody listed yet: a poll is not a first read.
      expect(store.pollConnections()).toBeUndefined()
      store.ensureConnectionsListed()
      await settle()
      expect(calls).toBe(1)

      // The agent's `database_client` tool connected on the server — no UI call announced it.
      rows = [connection('mine'), connection('agent-added')]
      const later = Date.now() + store.CONNECTIONS_POLL_MS
      const loading: boolean[] = []
      const unsubscribe = store.subscribeConnections(() =>
        loading.push(store.getConnectionsSnapshot().loading),
      )
      await store.pollConnections(later)
      expect(store.getConnectionsSnapshot().connections.map(({ id }) => id)).toEqual([
        'mine',
        'agent-added',
      ])
      expect(loading).not.toContain(true)

      // A second surface ticking in the same window costs nothing; an unmoved answer moves nothing.
      expect(store.pollConnections(later + 1)).toBeUndefined()
      const before = store.getConnectionsSnapshot()
      await store.pollConnections(later + store.CONNECTIONS_POLL_MS)
      unsubscribe()
      expect(calls).toBe(3)
      expect(store.getConnectionsSnapshot()).toBe(before)
    } finally {
      databaseApi.list = originalList
    }
  })

  test('an announced change re-reads a listed store, and fetches nothing for nobody', async () => {
    const { databaseApi } = await import('../api/databaseApi')
    const { DATABASE_CONNECTIONS } = await import('./topics')
    const store = await import('./connectionsStore')
    const originalList = databaseApi.list.bind(databaseApi)
    let calls = 0
    databaseApi.list = async () => {
      calls += 1
      return [connection(`v${calls}`)]
    }
    try {
      DATABASE_CONNECTIONS.invalidate()
      await settle()
      // No reader ever asked: an invalidation must not turn into a request.
      expect(calls).toBe(0)

      store.ensureConnectionsListed()
      await settle()
      DATABASE_CONNECTIONS.invalidate()
      await settle()
      expect(calls).toBe(2)
      expect(store.getConnectionsSnapshot().connections.map(({ id }) => id)).toEqual(['v2'])
    } finally {
      databaseApi.list = originalList
    }
  })
})

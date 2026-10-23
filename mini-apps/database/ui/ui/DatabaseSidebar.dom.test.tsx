import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { databaseApi } from '../api/databaseApi'
import type { DbConnectionInfo } from '../dbClient'
import type { DbConnectionsState } from '../model/useDbConnections'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

const connection: DbConnectionInfo = {
  id: 'primary',
  name: 'Primary',
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 1,
}

const model = (over: Partial<DbConnectionsState>): DbConnectionsState => ({
  connections: [connection],
  loading: false,
  listError: null,
  refreshList: () => {},
  reconnecting: {},
  reconnectError: {},
  upsert: () => {},
  ensureConnected: async () => undefined,
  disconnect: async () => {},
  remove: async () => null,
  rename: async () => {},
  updateConfig: async () => connection,
  healthCheck: async () => {},
  ...over,
})

async function render(state: DbConnectionsState) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { DatabaseSidebarView } = await import('./DatabaseSidebar')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<DatabaseSidebarView sessionId="chat-a" connectionModel={state} connectionOnly />)
  })
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('database sidebar loading ladder', () => {
  test('shows the loading line only while there is nothing to show', async () => {
    const originalSchemas = databaseApi.schemas.bind(databaseApi)
    databaseApi.schemas = async () => ({})
    try {
      const empty = await render(model({ loading: true, connections: [] }))
      // LoadingHint animates the ellipsis, so the text node is the bare label.
      expect(empty.host.textContent).toContain('Loading connections')
      await empty.cleanup()

      // A refreshList (the inline "Connections did not refresh · Retry", a health check)
      // also raises `loading` mid-session. With rows already on screen the panel must keep
      // them — replacing a populated tree with a loading line discards its expansion state
      // and scroll position to announce something the user can already see.
      const populated = await render(model({ loading: true }))
      expect(populated.host.textContent).not.toContain('Loading connections')
      // The connection picker + browser body, i.e. the panel the user was already looking
      // at. (The picker's trigger shows its placeholder here because `connectionOnly` does
      // not auto-select; what matters is that the rows branch rendered at all.)
      expect(populated.host.textContent).toContain('Select a connection')
      await populated.cleanup()
    } finally {
      databaseApi.schemas = originalSchemas
    }
  })
})

describe('database sidebar schema ownership', () => {
  test('the Connections root introspects nothing; a connection tab introspects its own', async () => {
    // The root's tree loads a schema per EXPANDED node. It also used to introspect whichever
    // connection was auto-selected — the object list plus the column prefetch — on every open,
    // for a `schema` nothing on that surface rendered.
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DatabaseSidebarView } = await import('./DatabaseSidebar')
    const originalSchemas = databaseApi.schemas.bind(databaseApi)
    const introspected: string[] = []
    databaseApi.schemas = async (id) => {
      introspected.push(id)
      return {}
    }
    const mount = async (node: React.ReactNode) => {
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      await act(async () => root.render(node))
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      return async () => {
        await act(async () => root.unmount())
        host.remove()
      }
    }
    try {
      const rootConnection = { ...connection, id: 'root-only' }
      const closeRoot = await mount(
        <DatabaseSidebarView
          sessionId="chat-a"
          connectionModel={model({ connections: [rootConnection] })}
          embedded
        />,
      )
      expect(introspected).toEqual([])
      await closeRoot()

      // Positive control: the per-connection tab renders `s.schema`, so it must still load it.
      const tabConnection = { ...connection, id: 'tab-only' }
      const closeTab = await mount(
        <DatabaseSidebarView
          sessionId="chat-a"
          connectionModel={model({ connections: [tabConnection] })}
          requestedConnectionId="tab-only"
          embedded
          connectionOnly
        />,
      )
      expect(introspected).toEqual(['tab-only'])
      await closeTab()
    } finally {
      databaseApi.schemas = originalSchemas
    }
  })
})

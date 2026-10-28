import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionInfo, SavedConnectionConfigResponse } from '../../dbClient'
import { databaseApi } from '../../api/databaseApi'
import type { DbConnectionsState } from '../../model/useDbConnections'
import type { useDatabaseSidebar as UseDatabaseSidebar } from './useDatabaseSidebar'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

const connection = (id: string): DbConnectionInfo => ({
  id,
  name: id,
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 1,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('database sidebar config request scope', () => {
  test('keeps the latest Edit target when config responses arrive out of order', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useDatabaseSidebar } = await import('./useDatabaseSidebar')
    const originalGetConfig = databaseApi.getConfig.bind(databaseApi)
    const originalSchemas = databaseApi.schemas.bind(databaseApi)
    const a = connection('a')
    const b = connection('b')
    const configs = new Map([
      ['a', deferred<SavedConnectionConfigResponse>()],
      ['b', deferred<SavedConnectionConfigResponse>()],
    ])
    databaseApi.getConfig = (id) => configs.get(id)!.promise
    databaseApi.schemas = async () => ({})
    const model: DbConnectionsState = {
      connections: [a, b],
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
      updateConfig: async () => a,
      healthCheck: async () => {},
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let state: ReturnType<typeof UseDatabaseSidebar> | null = null

    function Harness() {
      const latest = useDatabaseSidebar('chat-a', model)
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    try {
      await act(async () => root.render(<Harness />))
      let first!: Promise<void>
      let second!: Promise<void>
      await act(async () => {
        first = state!.startEditConfig(a)
        second = state!.startEditConfig(b)
        configs.get('b')!.resolve({
          name: 'b',
          config: { dialect: 'sqlite', file: '/b.db' },
        })
        await second
      })
      expect(state!.editingConfig?.connection.id).toBe('b')

      await act(async () => {
        configs.get('a')!.resolve({
          name: 'a',
          config: { dialect: 'sqlite', file: '/a.db' },
        })
        await first
      })
      expect(state!.editingConfig?.connection.id).toBe('b')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.getConfig = originalGetConfig
      databaseApi.schemas = originalSchemas
    }
  })
})

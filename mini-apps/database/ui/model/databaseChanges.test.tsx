import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import type { DbConnectionInfo } from '../dbClient'
import { parseDatabaseChange } from '../../shared/database-changes'

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
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  restoreRealtime()
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

let seq = 0
/** What the stream router does with the tool's `emitCommand`, from a chat that is NOT on screen. */
async function frameFromBackgroundChat(payload: unknown) {
  const { miniAppCommandBus } = await import('@localixai/mini-app-sdk/ui/commands')
  const { initDatabaseChanges } = await import('./databaseChanges')
  initDatabaseChanges()
  seq += 1
  miniAppCommandBus.publish(
    {
      sessionId: 'background',
      miniApp: 'database',
      channel: 'changes',
      payload,
      commandId: `c${seq}`,
      seq,
    },
    false,
  )
}

describe('the agent’s writes reach the workbench without a reload', () => {
  test('a connection change re-reads the list, from any chat', async () => {
    const { DATABASE_CONNECTIONS } = await import('./topics')
    const heard: Array<string | null> = []
    const unsubscribe = DATABASE_CONNECTIONS.subscribe((key) => heard.push(key))
    await frameFromBackgroundChat({ type: 'connections' })
    unsubscribe()
    expect(heard).toEqual([null])
  })

  // The list polled every 4 s for the one change no UI call announces — the agent's — after that
  // change had become a push. The poll is the backstop for what no frame carries, so it is slow.
  test('the list poll is a backstop: the agent’s change is pushed, not polled for', async () => {
    const { CONNECTIONS_POLL_MS } = await import('./connectionsStore')
    expect(CONNECTIONS_POLL_MS).toBeGreaterThanOrEqual(30_000)
  })

  test('a schema change forgets that connection’s schema — every listed one when unnamed', async () => {
    const { schemaStore } = await import('./schemaStore')
    const { updateConnections, resetConnectionsStore } = await import('./connectionsStore')
    const original = schemaStore.invalidate
    const invalidated: string[] = []
    schemaStore.invalidate = (id: string) => void invalidated.push(id)
    try {
      await frameFromBackgroundChat({ type: 'schema', connectionId: 'a' })
      updateConnections(() => [connection('a'), connection('b')])
      await frameFromBackgroundChat({ type: 'schema' })
      expect(invalidated).toEqual(['a', 'a', 'b'])
    } finally {
      schemaStore.invalidate = original
      resetConnectionsStore()
    }
  })

  test('an open table page re-reads its rows for its own connection only', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../api/databaseApi')
    const { useBrowsePage } = await import('../ui/table-data/useBrowsePage')
    const original = databaseApi.browse.bind(databaseApi)
    let reads = 0
    databaseApi.browse = async () => {
      reads += 1
      return { columns: [{ name: 'id' }], rows: [[reads]], durationMs: 1 }
    }
    function Page({ visible }: { visible: boolean }) {
      useBrowsePage({ connection: connection('a'), target: { table: 'users' }, visible })
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Page visible />))
      expect(reads).toBe(1)
      await act(async () => frameFromBackgroundChat({ type: 'data', connectionId: 'b' }))
      expect(reads).toBe(1)
      await act(async () => frameFromBackgroundChat({ type: 'data', connectionId: 'a' }))
      expect(reads).toBe(2)
      // A hidden page does not read now; it reads the moved rows when shown.
      await act(async () => root.render(<Page visible={false} />))
      await act(async () => frameFromBackgroundChat({ type: 'data' }))
      expect(reads).toBe(2)
      await act(async () => root.render(<Page visible />))
      expect(reads).toBe(3)
    } finally {
      await act(async () => root.unmount())
      databaseApi.browse = original
    }
  })

  test('a frame that is not a database change is ignored', () => {
    expect(parseDatabaseChange({ type: 'rows' })).toBeNull()
    expect(parseDatabaseChange({ type: 'data', connectionId: 7 })).toBeNull()
    expect(parseDatabaseChange(null)).toBeNull()
    expect(parseDatabaseChange({ type: 'data' })).toEqual({ type: 'data' })
  })
})

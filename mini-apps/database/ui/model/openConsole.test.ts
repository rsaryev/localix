import { afterEach, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerInspectorHandler, type InspectorRequest } from '@localixai/kit/testing'
import {
  closeDbConnectionWorkItems,
  connectionWorkItemId,
  consolePrefix,
  diagramWorkItemId,
  newDbConsole,
  openDbConnection,
  openDbConsole,
  openDbDiagram,
  openDbTable,
  tableWorkItemId,
} from './openConsole'
import { dbConsoleBus, type DbConsoleCommand } from './dbConsoleBus'

const requests: InspectorRequest[] = []
let unregister: (() => void) | undefined

afterEach(() => {
  unregister?.()
  unregister = undefined
  requests.length = 0
})

function capture() {
  unregister = registerInspectorHandler((request) => requests.push(request))
}

const connection = {
  id: 'primary',
  name: 'Primary',
  dialect: 'postgres' as const,
  connected: true,
  readonly: false,
  createdAt: 1,
}

describe('database work-item identities', () => {
  test('connection, primary console and diagram use stable restorable identities', () => {
    capture()
    openDbConnection('chat-a', connection)
    openDbConsole('chat-a', connection.id, connection.name, connection.dialect)
    openDbDiagram('chat-a', connection)

    expect(requests.map((request) => (request.kind === 'work-item' ? request.id : ''))).toEqual([
      connectionWorkItemId('primary'),
      consolePrefix('primary'),
      diagramWorkItemId('primary'),
    ])
    expect(requests.every((request) => request.kind === 'work-item')).toBe(true)
    // Each tab names the chat it opens in; the host refuses a session kind that names none.
    expect(requests.map((request) => (request.kind === 'work-item' ? request.scope : ''))).toEqual([
      'chat-a',
      'chat-a',
      'chat-a',
    ])
    expect(requests[1]).toMatchObject({
      kind: 'work-item',
      workKind: 'database:console',
      payload: { connectionId: 'primary', dialect: 'postgres', readonly: false },
    })
  })

  test('additional consoles keep independent ids under the connection prefix', () => {
    capture()
    newDbConsole('chat-a', 'primary', 'Primary', 'postgres')
    newDbConsole('chat-a', 'primary', 'Primary', 'postgres')

    const ids = requests.map((request) => (request.kind === 'work-item' ? request.id : ''))
    expect(ids[0]).toStartWith(`${consolePrefix('primary')}:`)
    expect(ids[1]).toStartWith(`${consolePrefix('primary')}:`)
    expect(ids[0]).not.toBe(ids[1])
  })

  test('table identity safely preserves schema/table punctuation and its requested mode', () => {
    capture()
    openDbTable({
      sessionId: 'chat-a',
      connectionId: 'primary',
      connectionName: 'Primary',
      dialect: 'postgres',
      schema: 'team/data',
      table: 'order:items',
      mode: 'edit-structure',
    })

    expect(requests[0]).toMatchObject({
      kind: 'work-item',
      workKind: 'database:table',
      id: tableWorkItemId('primary', 'order:items', 'team/data'),
      scope: 'chat-a',
      payload: {
        connectionId: 'primary',
        schema: 'team/data',
        table: 'order:items',
        requestedMode: 'edit-structure',
      },
    })
    expect((requests[0] as Extract<InspectorRequest, { kind: 'work-item' }>).id).toContain(
      'team%2Fdata',
    )
  })

  test('removing a connection closes every owned tab family in EVERY chat, including extra consoles', () => {
    // The connection is app-wide: closing only the removing chat's tabs left other chats holding
    // tabs for a connection that no longer exists. Session tabs carry their chat in their grid id,
    // so the close says it reaches every chat rather than naming none.
    capture()
    closeDbConnectionWorkItems('primary')
    expect(requests).toEqual([
      { kind: 'close-work-items', prefix: 'database:connection:primary', everyChat: true },
      { kind: 'close-work-items', prefix: 'database:console:primary', everyChat: true },
      { kind: 'close-work-items', prefix: 'database:table:primary:', everyChat: true },
      { kind: 'close-work-items', prefix: 'database:diagram:primary', everyChat: true },
    ])
  })
})

describe('console commands', () => {
  test('reach only the console of the chat that sent them', () => {
    // Two chats each hold a console for one connection. Keyed by connection alone, "open this
    // query" from chat A replaced the draft in chat B's console too.
    const seenA: DbConsoleCommand[] = []
    const seenB: DbConsoleCommand[] = []
    const offA = dbConsoleBus.subscribe('chat-a', 'primary', (cmd) => seenA.push(cmd))
    const offB = dbConsoleBus.subscribe('chat-b', 'primary', (cmd) => seenB.push(cmd))
    try {
      dbConsoleBus.send('chat-a', 'primary', { kind: 'set-query', sql: 'select 1' })
      expect(seenA).toEqual([{ kind: 'set-query', sql: 'select 1' }])
      expect(seenB).toEqual([])
    } finally {
      offA()
      offB()
    }
  })
})

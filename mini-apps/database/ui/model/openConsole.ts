// Open / close a connection's SQL-console grid tab via the GENERIC inspector bus. The
// database workbench owns its `db-console` WorkItemKind, the per-connection tab-id formula,
// and the payload shape here — core just opens/closes what it's told (see inspectorBus
// `openWorkItem` / `closeWorkItems`), so nothing db-specific lives in the shared bus.
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import type { ConnectionColor, DbConnectionInfo, DbDialect } from '../dbClient'
import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import { connectionDisplayName } from './connectionDisplayName'
import { dbConnectionResourceUri, dbResourceUri } from './dbResourceUri'

/** The contributed WorkItemKind for a database console tab (registered in `register.tsx`). */
export const DB_CONNECTION_KIND = 'database:connection'
export const DB_CONSOLE_KIND = 'database:console'
/** A table data/structure tab. Queries and tables remain separate work-item types. */
export const DB_TABLE_KIND = 'database:table'
/** A connection-scoped relationship diagram tab. */
export const DB_DIAGRAM_KIND = 'database:diagram'
export type DbTableOpenMode = 'browse' | 'edit-rows' | 'edit-structure'

/** All of one connection's console tabs share this id prefix (primary = the bare prefix,
 *  extra consoles = `<prefix>:<rand>`), so closing a removed connection is one prefix sweep. */
export const connectionWorkItemId = (connectionId: string) =>
  `${DB_CONNECTION_KIND}:${connectionId}`
export const consolePrefix = (connectionId: string) => `${DB_CONSOLE_KIND}:${connectionId}`
export const tablePrefix = (connectionId: string) => `${DB_TABLE_KIND}:${connectionId}:`
export const diagramWorkItemId = (connectionId: string) => `${DB_DIAGRAM_KIND}:${connectionId}`

export function tableWorkItemId(connectionId: string, table: string, schema?: string): string {
  return `${tablePrefix(connectionId)}${encodeURIComponent(schema ?? '')}:${encodeURIComponent(table)}`
}

function consolePayload(
  connectionId: string,
  dialect: DbDialect,
  readonly?: boolean,
  color?: ConnectionColor,
) {
  return { connectionId, dialect, readonly: readonly ?? false, color }
}

/*
 * Every opener names the chat its tab opens in. A console runs edit prediction for its chat, and
 * the browser, table and diagram tabs open consoles, so every database tab is a session kind: the
 * host refuses one without a chat, and a tab the host placed by guessing would predict, and open
 * its consoles, for whichever chat happened to be on screen. The caller passes its own session —
 * the tab it sits in, or the status item's chat.
 */

/** Open or focus the stable schema-browser tab owned by one connection. */
export function openDbConnection(sessionId: string, connection: DbConnectionInfo): void {
  const title = connectionDisplayName(connection)
  miniAppWorkspace.openWorkItem({
    workKind: DB_CONNECTION_KIND,
    id: connectionWorkItemId(connection.id),
    title,
    scope: sessionId,
    payload: {
      connectionId: connection.id,
      connectionName: title,
      dialect: connection.dialect,
      readonly: connection.readonly ?? false,
      color: connection.color,
      resourceUri: dbConnectionResourceUri(connection.id),
    },
  })
}

/** Open (or focus) a connection's PRIMARY console (one tab per connection). */
export function openDbConsole(
  sessionId: string,
  connectionId: string,
  name: string,
  dialect: DbDialect,
  readonly?: boolean,
  color?: ConnectionColor,
): void {
  miniAppWorkspace.openWorkItem({
    workKind: DB_CONSOLE_KIND,
    id: consolePrefix(connectionId),
    title: name,
    scope: sessionId,
    payload: consolePayload(connectionId, dialect, readonly, color),
  })
}

/** Open an ADDITIONAL, independent console for a connection (its own editor draft), minting
 *  a unique id so several coexist; the grid numbers them ("app", "app 2", …). */
export function newDbConsole(
  sessionId: string,
  connectionId: string,
  name: string,
  dialect: DbDialect,
  readonly?: boolean,
  color?: ConnectionColor,
): void {
  const rand = (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).slice(0, 8)
  miniAppWorkspace.openWorkItem({
    workKind: DB_CONSOLE_KIND,
    id: `${consolePrefix(connectionId)}:${rand}`,
    title: name,
    scope: sessionId,
    payload: consolePayload(connectionId, dialect, readonly, color),
  })
}

/**
 * Open or focus one table tab. The stable connection/schema/table identity is deliberate:
 * reopening a table refreshes the user's existing work context instead of creating copies.
 */
export function openDbTable(opts: {
  sessionId: string
  connectionId: string
  connectionName: string
  dialect: DbDialect
  readonly?: boolean
  color?: ConnectionColor
  table: string
  schema?: string
  mode?: DbTableOpenMode
}): void {
  miniAppWorkspace.openWorkItem({
    workKind: DB_TABLE_KIND,
    id: tableWorkItemId(opts.connectionId, opts.table, opts.schema),
    title: opts.table,
    scope: opts.sessionId,
    payload: {
      connectionId: opts.connectionId,
      connectionName: opts.connectionName,
      dialect: opts.dialect,
      readonly: opts.readonly ?? false,
      color: opts.color,
      table: opts.table,
      schema: opts.schema,
      requestedMode: opts.mode ?? 'browse',
      requestNonce: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`,
      resourceUri: dbResourceUri(
        opts.connectionId,
        opts.schema ?? DATABASE_DRIVER_CATALOG[opts.dialect].defaultSchema,
        opts.table,
      ),
    },
  })
}

/** Open or focus a connection's relationship diagram as a first-class editor tab. */
export function openDbDiagram(sessionId: string, connection: DbConnectionInfo): void {
  const title = connectionDisplayName(connection)
  miniAppWorkspace.openWorkItem({
    workKind: DB_DIAGRAM_KIND,
    id: diagramWorkItemId(connection.id),
    title: `${title} relationships`,
    scope: sessionId,
    payload: {
      connectionId: connection.id,
      connectionName: title,
      dialect: connection.dialect,
      readonly: connection.readonly ?? false,
      color: connection.color,
      resourceUri: dbConnectionResourceUri(connection.id),
    },
  })
}

/**
 * Close every browser, query and table work item a removed connection owns — in EVERY chat. The
 * connection is app-wide, so its tabs are gone wherever they were opened; closing only the
 * removing chat's left the others pointing at a connection that no longer exists. These are
 * session tabs whose grid ids carry their chat, so the close says it reaches every chat.
 */
export function closeDbConnectionWorkItems(connectionId: string): void {
  const everyChat = { everyChat: true }
  miniAppWorkspace.closeWorkItems(connectionWorkItemId(connectionId), everyChat)
  miniAppWorkspace.closeWorkItems(consolePrefix(connectionId), everyChat)
  miniAppWorkspace.closeWorkItems(tablePrefix(connectionId), everyChat)
  miniAppWorkspace.closeWorkItems(diagramWorkItemId(connectionId), everyChat)
}

import type { WorkItemLike } from '@localixai/mini-app-sdk/ui'
import type { ConnectionColor, DbDialect } from './dbClient'
import type { DbTableOpenMode } from './model/openConsole'

/**
 * Read a restored WorkItem's untyped payload into the props its tab renders with.
 *
 * The defect this stops: each body component read `item.payload` inline, so one engine's console
 * could forget a field its siblings passed — the KV / document / search consoles once got no
 * `consoleId` at all, and two consoles on one connection then shared ONE persisted draft. Reading
 * the payload once here gives every engine the same identity, and makes it testable without
 * mounting a lazily loaded console.
 */
export interface ConsoleItemProps {
  /** The WorkItem id — unique per console tab, unlike the connection id it shares. */
  consoleId: string
  connectionId: string
  dialect: DbDialect
  readonly: boolean
  dbLabel: string
}

export function readConsoleItem(item: WorkItemLike): ConsoleItemProps {
  return {
    consoleId: item.id,
    connectionId: (item.payload?.connectionId as string) ?? '',
    dialect: (item.payload?.dialect as DbDialect) ?? 'sqlite',
    readonly: (item.payload?.readonly as boolean) ?? false,
    dbLabel: item.title,
  }
}

export interface TableItemProps {
  connectionId: string
  connectionName: string
  dialect: DbDialect
  readonly: boolean
  color?: ConnectionColor
  table: string
  schema?: string
  requestedMode?: DbTableOpenMode
  requestNonce?: string
}

export function readTableItem(item: WorkItemLike): TableItemProps {
  const payload = item.payload
  const connectionId = (payload?.connectionId as string) ?? ''
  return {
    connectionId,
    connectionName: (payload?.connectionName as string) ?? connectionId,
    dialect: (payload?.dialect as DbDialect) ?? 'sqlite',
    readonly: (payload?.readonly as boolean) ?? false,
    color: payload?.color as ConnectionColor | undefined,
    table: (payload?.table as string) ?? item.title,
    schema: typeof payload?.schema === 'string' ? payload.schema : undefined,
    requestedMode:
      typeof payload?.requestedMode === 'string'
        ? (payload.requestedMode as DbTableOpenMode)
        : undefined,
    requestNonce: typeof payload?.requestNonce === 'string' ? payload.requestNonce : undefined,
  }
}

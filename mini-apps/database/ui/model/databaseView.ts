import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/ui'

export const DATABASE_AREA_KEY = 'localix.database.area'
export const DATABASE_CONNECTION_KEY = 'localix.database.connection'

export type DatabaseArea = 'overview' | 'explorer'

const AREAS = new Set<DatabaseArea>(['overview', 'explorer'])

/** Normalize persisted or externally supplied workspace navigation state. */
export function normalizeDatabaseArea(value: unknown): DatabaseArea {
  return typeof value === 'string' && AREAS.has(value as DatabaseArea)
    ? (value as DatabaseArea)
    : 'overview'
}

export function saveDatabaseArea(area: DatabaseArea): void {
  saveString(DATABASE_AREA_KEY, area)
}

/** The last selected connection is workspace navigation state, not console state. */
export function loadDatabaseConnectionId(): string | null {
  const value = loadString(DATABASE_CONNECTION_KEY)
  return typeof value === 'string' && value.trim() ? value : null
}

export function saveDatabaseConnectionId(connectionId: string): void {
  saveString(DATABASE_CONNECTION_KEY, connectionId)
}

export interface DatabaseResourceTarget {
  connectionId: string
  schema?: string
  table?: string
  column?: string
}

/** Parse the provider's positional connection/_/schema/table/column grammar. */
export function databaseTargetFromUri(uri: unknown): DatabaseResourceTarget | null {
  if (typeof uri !== 'string') return null
  const parsed = parseLocalixResourceUri(uri)
  if (parsed?.provider !== 'db') return null
  const parts = parsed.segments
  if (!parts[0]) return null
  try {
    const connectionId = decodeURIComponent(parts[0])
    if (parts.length === 1) return { connectionId }
    if (parts[1] !== '_') return { connectionId }
    const schema = parts[2] ? decodeURIComponent(parts[2]) : undefined
    const table = parts[3] ? decodeURIComponent(parts[3]) : undefined
    const column = parts[4] ? decodeURIComponent(parts[4]) : undefined
    return { connectionId, schema, table, column }
  } catch {
    return null
  }
}

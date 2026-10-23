import { useCallback, useRef, useSyncExternalStore } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { SchemaSnapshot } from './schemaEntry'
import { getCachedTable, getCachedTableError } from './schemaKey'
import { schemaStore } from './schemaStore'
import type { SchemaReader } from './schemaTreeRows'

/**
 * The schema of SEVERAL connections at once, for the one flat connections tree.
 *
 * `useSchema` is one hook per connection, so it only fits a tree whose every connection is its
 * own component — the nested shape a windowed tree cannot have. This reads the same shared store
 * for a set of ids and hands back one reader per id, stable while that connection's snapshot is,
 * so rows built from an unchanged connection keep their identity across another's commit.
 */

const readers = new WeakMap<SchemaSnapshot, SchemaReader>()

function readerFor(connectionId: string, snap: SchemaSnapshot): SchemaReader {
  const cached = readers.get(snap)
  if (cached) return cached
  const reader: SchemaReader = {
    schemas: snap.schemas,
    loading: snap.loading,
    error: snap.error,
    errorDetail: snap.errorDetail,
    reload: () => schemaStore.reload(connectionId),
    getTable: (table, schema) => getCachedTable(snap.tables, table, schema),
    getTableError: (table, schema) => getCachedTableError(snap.tableErrors, table, schema),
    getTableErrorDetail: (table, schema) =>
      getCachedTableError(snap.tableErrorDetails, table, schema),
    loadTable: (table, schema) => schemaStore.loadTable(connectionId, table, schema),
    reloadTable: (table, schema) => schemaStore.reloadTable(connectionId, table, schema),
  }
  readers.set(snap, reader)
  return reader
}

export function useSchemaSources(
  connectionIds: readonly string[],
): ReadonlyMap<string, SchemaReader> {
  const visible = useWorkItemVisible()
  const idsKey = connectionIds.join('\u0000')
  const cache = useRef<{ key: string; snaps: SchemaSnapshot[]; value: Map<string, SchemaReader> }>(
    null,
  )

  const subscribe = useCallback(
    (onChange: () => void) => {
      // A parked tab holds no subscription, exactly like `useSchema`: no discovery, no prefetch.
      if (!visible || !idsKey) return () => {}
      const unsubscribes = idsKey.split('\u0000').map((id) => schemaStore.subscribe(id, onChange))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [idsKey, visible],
  )
  const getSnapshot = useCallback(() => {
    const list = idsKey ? idsKey.split('\u0000') : []
    const snaps = list.map((id) => schemaStore.getSnapshot(id))
    const previous = cache.current
    if (previous?.key === idsKey && previous.snaps.every((snap, index) => snap === snaps[index]))
      return previous.value
    const value = new Map(list.map((id, index) => [id, readerFor(id, snaps[index]!)]))
    cache.current = { key: idsKey, snaps, value }
    return value
  }, [idsKey])
  return useSyncExternalStore(subscribe, getSnapshot)
}

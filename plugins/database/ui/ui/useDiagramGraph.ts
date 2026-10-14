import { useMemo } from 'react'

import type { DbTableSchema } from '../dbClient'
import {
  decodeVisibleKey,
  layoutNodes,
  nodeIdentity,
  relationEdges,
  visibleNodeKey,
  type DiagramTable,
  type LayoutDirection,
} from '../model/diagramLayout'
import type { DiagramObject } from '../model/diagramScope'
import { visibleColumns, type DiagramNode } from './DiagramTableNode'

/**
 * The relationship diagram's graph: tables with structure → edges → visible set → laid-out nodes.
 *
 * The defect it stops: the chain used to be memoized on the whole `SchemaState`, and that object is
 * rebuilt on every render of its owner — so `allTables`, then `allEdges`, then a complete dagre
 * layout re-ran on every render (a hover, a timer, a parent re-render) for an identical graph. The
 * inputs here are the ones that actually change the graph: the object list and `getTable`, which
 * `useSchema` keeps referentially stable until the cached structures themselves change.
 */
export function useDiagramGraph({
  objects,
  getTable,
  focusedId,
  query,
  direction,
}: {
  objects: readonly DiagramObject[]
  getTable: (table: string, schema?: string) => DbTableSchema | undefined
  focusedId: string | null
  query: string
  direction: LayoutDirection
}) {
  const allTables = useMemo<DiagramTable[]>(
    () =>
      objects.flatMap((object) => {
        const detail = getTable(object.name, object.schema)
        return detail ? [{ ...object, detail }] : []
      }),
    [objects, getTable],
  )
  const allEdges = useMemo(() => relationEdges(allTables), [allTables])
  // The visible set as a STABLE STRING first, the Set derived from it second: most characters of
  // a word match the same tables, and an unchanged key keeps the layout memo below from re-running.
  const visibleKey = useMemo(
    () => visibleNodeKey(allTables, allEdges, focusedId, query),
    [allEdges, allTables, focusedId, query],
  )
  const visibleIds = useMemo(() => decodeVisibleKey(visibleKey), [visibleKey])
  const edges = useMemo(
    () => allEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [allEdges, visibleIds],
  )
  const nodes = useMemo(() => {
    const incoming = new Map<string, Set<string>>()
    for (const table of allTables)
      for (const foreignKey of table.detail.foreignKeys) {
        const id = nodeIdentity(foreignKey.refSchema ?? table.schema, foreignKey.refTable)
        const names = incoming.get(id) ?? new Set<string>()
        for (const name of foreignKey.refColumns) names.add(name)
        incoming.set(id, names)
      }
    const raw: DiagramNode[] = allTables.flatMap((table) => {
      const id = nodeIdentity(table.schema, table.name)
      if (!visibleIds.has(id)) return []
      const visible = visibleColumns(table.detail, incoming.get(id) ?? new Set())
      return [
        {
          id,
          type: 'databaseTable',
          position: { x: 0, y: 0 },
          data: { table: table.name, schema: table.schema, ...visible, focused: id === focusedId },
        },
      ]
    })
    return layoutNodes(raw, edges, direction)
  }, [allTables, direction, edges, focusedId, visibleIds])

  return { allTables, allEdges, visibleKey, edges, nodes }
}

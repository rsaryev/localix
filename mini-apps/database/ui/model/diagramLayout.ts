import dagre from 'dagre'
import type { CanvasEdgeType } from '@localixai/kit/canvas'
import { schemaTableKey } from './schemaKey'
import type { DbTableSchema } from '../dbClient'

/**
 * Pure graph work for the relationship diagram: which tables are visible, and where the
 * boxes go. Kept out of the component so both are testable and so the expensive part —
 * a full dagre layout — has one caller and one measurable cost.
 */

export type LayoutDirection = 'LR' | 'TB'

/** Stable cache identity for a diagram node, matching the schema cache's own keying. */
export const nodeIdentity = (schema: string | undefined, table: string) =>
  schemaTableKey(table, schema)

/**
 * Separator for the packed visible-set key. NUL as an ESCAPE, never a literal NUL byte in
 * source: a raw NUL makes the line invisible to grep and to a reviewer's eye. A space would
 * be worse than invisible — `CREATE TABLE "my table"` is valid SQL, so a space separator
 * splits one id into two and decodes into node ids that never existed.
 */
const KEY_SEP = '\u0000'

/** A table with its introspected structure, as the diagram assembles them. */
export interface DiagramTable {
  name: string
  schema?: string
  detail: DbTableSchema
}

/** The minimal edge shape the visibility walk needs (React Flow edges satisfy it). */
export interface DiagramEdgeEnds {
  source: string
  target: string
}

/**
 * The set of visible node ids, packed as a SORTED, separator-joined string.
 *
 * A string rather than a Set on purpose: it is the memo key the diagram hangs its layout
 * on. Typing narrows the filter character by character, and most characters of a word do
 * not change which tables match — with a fresh Set per keystroke, every one of those
 * keystrokes invalidated the node memo and re-ran dagre over the whole graph for an
 * identical result. Equal sets now produce an equal key, so the layout is skipped.
 *
 * Precedence matches what the UI offers: a focused table (it plus its direct relations)
 * wins over "everything", and an active query replaces both.
 */
export function visibleNodeKey(
  tables: DiagramTable[],
  edges: DiagramEdgeEnds[],
  focusedId: string | null,
  query: string,
): string {
  let ids: Set<string>
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized) {
    ids = new Set<string>()
    for (const table of tables) {
      const matchesIdentity =
        table.name.toLocaleLowerCase().includes(normalized) ||
        table.schema?.toLocaleLowerCase().includes(normalized)
      const matchesColumn = table.detail.columns.some((column) =>
        column.name.toLocaleLowerCase().includes(normalized),
      )
      if (matchesIdentity || matchesColumn) ids.add(nodeIdentity(table.schema, table.name))
    }
  } else if (focusedId) {
    ids = new Set([focusedId])
    for (const edge of edges) {
      if (edge.source === focusedId) ids.add(edge.target)
      if (edge.target === focusedId) ids.add(edge.source)
    }
  } else {
    ids = new Set(tables.map((table) => nodeIdentity(table.schema, table.name)))
  }
  return [...ids].sort().join(KEY_SEP)
}

/**
 * One edge per foreign-key column, from that column's row to the referenced column's row, in the
 * board's info tone with right-angled routing between the rows. A reference to a table that is not
 * on the diagram has nowhere to land, so it draws nothing.
 */
export function relationEdges(tables: DiagramTable[]): CanvasEdgeType[] {
  const tableIds = new Set(tables.map((table) => nodeIdentity(table.schema, table.name)))
  return tables.flatMap((table) =>
    table.detail.foreignKeys.flatMap((foreignKey, relationIndex) => {
      const targetId = nodeIdentity(foreignKey.refSchema ?? table.schema, foreignKey.refTable)
      if (!tableIds.has(targetId)) return []
      const sourceId = nodeIdentity(table.schema, table.name)
      return foreignKey.columns.map((column, columnIndex) => ({
        id: `${sourceId}:${relationIndex}:${column}`,
        source: sourceId,
        target: targetId,
        sourceHandle: column,
        targetHandle: foreignKey.refColumns[columnIndex] ?? foreignKey.refColumns[0],
        data: { tone: 'info' as const, route: 'step' as const },
      }))
    }),
  )
}

/** Unpack {@link visibleNodeKey}. An empty key is an empty set, not a set of one blank id. */
export function decodeVisibleKey(key: string): Set<string> {
  return new Set(key ? key.split(KEY_SEP) : [])
}

export const NODE_WIDTH = 252
export const ROW_HEIGHT = 25
export const NODE_HEADER_HEIGHT = 43

/** Node height is driven by how many column rows the card shows (plus a "+N more" row). */
function nodeHeight(rows: number): number {
  return NODE_HEADER_HEIGHT + rows * ROW_HEIGHT
}

/**
 * Run dagre over the visible subgraph and convert its centre-origin coordinates to the
 * top-left origin the board expects. The one expensive step in a diagram render.
 */
export function layoutNodes<
  T extends { id: string; data: { columns: unknown[]; hiddenColumns: number } },
>(
  nodes: T[],
  edges: DiagramEdgeEnds[],
  direction: LayoutDirection,
): Array<T & { position: { x: number; y: number } }> {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: direction,
    ranksep: direction === 'LR' ? 120 : 90,
    nodesep: 44,
    marginx: 28,
    marginy: 28,
  })
  for (const node of nodes) {
    const rows = node.data.columns.length + (node.data.hiddenColumns > 0 ? 1 : 0)
    graph.setNode(node.id, { width: NODE_WIDTH, height: nodeHeight(rows) })
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)
  return nodes.map((node) => {
    const position = graph.node(node.id)
    const rows = node.data.columns.length + (node.data.hiddenColumns > 0 ? 1 : 0)
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - nodeHeight(rows) / 2,
      },
    }
  })
}

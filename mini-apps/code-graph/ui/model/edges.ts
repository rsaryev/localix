import type { EdgeKind } from '../../shared/model'
import type { GraphView, ViewEdge } from '../../shared/view'

const OVERVIEW_LIMIT = 160
const FOCUS_LIMIT = 120
const PER_GROUP_LIMIT = 6

export function countOf(kinds: Partial<Record<EdgeKind, number>>, enabled: ReadonlySet<EdgeKind>) {
  let count = 0
  for (const [kind, value] of Object.entries(kinds) as Array<[EdgeKind, number]>) {
    if (enabled.has(kind)) count += value
  }
  return count
}

function strongest(a: ViewEdge, b: ViewEdge): number {
  return b.count - a.count || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
}

/**
 * At rest the map shows a bounded summary between containers. Choosing a box reveals its exact
 * file edges. The backend retains the full graph for inspection and tools; this is a drawing plan.
 */
export function visibleEdges(
  view: GraphView,
  enabled: ReadonlySet<EdgeKind>,
  focus: string | null,
): { edges: ViewEdge[]; total: number } {
  const groupOf = new Map(
    view.nodes.filter((node) => node.group).map((node) => [node.id, node.group as string]),
  )
  const top = (id: string) => groupOf.get(id) ?? id
  if (focus) {
    const focusIsGroup = view.nodes.some((node) => node.id === focus && node.role === 'child')
    const related = view.edges
      .filter((edge) =>
        focusIsGroup
          ? top(edge.source) === focus || top(edge.target) === focus
          : edge.source === focus || edge.target === focus,
      )
      .map((edge) => ({ ...edge, count: countOf(edge.kinds, enabled) }))
      .filter((edge) => edge.count > 0)
      .sort(strongest)
    return { edges: related.slice(0, FOCUS_LIMIT), total: related.length }
  }

  const grouped = new Map<string, ViewEdge>()
  for (const edge of view.edges) {
    const source = top(edge.source)
    const target = top(edge.target)
    if (source === target) continue
    const count = countOf(edge.kinds, enabled)
    if (count === 0) continue
    const key = `${source}\u0000${target}`
    const known = grouped.get(key)
    if (known) {
      known.count += count
      known.cyclic ||= edge.cyclic === true
    } else {
      grouped.set(key, { source, target, count, kinds: {}, cyclic: edge.cyclic === true })
    }
  }
  const ranked = [...grouped.values()].sort(strongest)
  const shown: ViewEdge[] = []
  const used = new Map<string, number>()
  for (const edge of ranked) {
    if (shown.length === OVERVIEW_LIMIT) break
    if (
      (used.get(edge.source) ?? 0) >= PER_GROUP_LIMIT ||
      (used.get(edge.target) ?? 0) >= PER_GROUP_LIMIT
    )
      continue
    shown.push(edge)
    used.set(edge.source, (used.get(edge.source) ?? 0) + 1)
    used.set(edge.target, (used.get(edge.target) ?? 0) + 1)
  }
  return { edges: shown, total: ranked.length }
}

import { location, nodeLine, percent, plural, TextBudget } from '../shared/format'
import type { EdgeKind } from '../shared/model'
import type { NodeDetail } from '../shared/view'
import type { GraphStats } from './graph/build'
import type { CodeGraph } from './graph/code-graph'
import { projectStructure } from './graph/structure'
import type { ImpactEntry, PathStep } from './graph/traverse'
import { EDGE_KIND_LABEL, graphView } from './graph/view'
import type { IndexStatus, PublishedGraph } from './indexing/project-index'

/**
 * The text the agent reads. Every answer opens with the facts that qualify it — how complete the
 * map is, how fresh — because a model that does not know 30% of calls went unresolved treats a
 * missing edge as proof that nothing calls a function.
 */
export const DEFAULT_BUDGET = 6000

export function statusLine(status: IndexStatus, published: PublishedGraph | null): string {
  if (!published) {
    if (status.state === 'failed')
      return `The code graph could not be built: ${status.error ?? 'unknown error'}.`
    const progress = status.progress
      ? ` (${status.progress.done}/${status.progress.total} files)`
      : ''
    return `The code graph is being built${progress}. Try again in a moment.`
  }
  const { stats } = published
  const { calls } = stats
  const unresolved = calls.total - calls.resolved - calls.external
  const parts = [
    `Code graph of ${plural(stats.files, 'file')}, ${plural(stats.symbols, 'symbol')}`,
    `call sites: ${percent(calls.resolved, calls.total)} linked to project code, ${percent(calls.external, calls.total)} into dependencies, ${percent(unresolved, calls.total)} unresolved — mostly method calls on values whose type a syntax-only map cannot know, so a missing "called by" is not proof nothing calls it`,
  ]
  if (published.omitted > 0)
    parts.push(`${plural(published.omitted, 'file')} over the size limit not indexed`)
  if (status.state === 'indexing') parts.push('refreshing now')
  if (status.error) parts.push(`last refresh failed: ${status.error}`)
  return `${parts.join('; ')}.`
}

export function describeOverview(
  published: PublishedGraph,
  scopeId: string,
  budget = DEFAULT_BUDGET,
): string {
  const { graph, stats } = published
  const out = new TextBudget(budget)
  const view = graphView(graph, scopeId)
  if (!view) return `No node ${scopeId}.`
  out.push(`Languages: ${languages(stats)}. Edges: ${edgeCounts(stats)}.`)
  out.push('')
  const childCount = view.nodes.filter((n) => n.role === 'child').length
  const hidden = view.truncated ? ` (+${view.truncated} less connected not listed)` : ''
  out.push(`${view.scope.id} — ${plural(childCount, 'child', 'children')}${hidden}:`)
  for (const node of view.nodes
    .filter((n) => n.role === 'child')
    .sort((a, b) => b.dependents - a.dependents)) {
    if (!out.push(`  ${nodeLine(node)}  size ${node.size}`)) break
  }
  const crossings = [...view.edges].sort((a, b) => b.count - a.count).slice(0, 25)
  if (crossings.length > 0) {
    out.push('')
    out.push('Strongest dependencies at this level (source → target ×count):')
    for (const edge of crossings) {
      const cycle = edge.cyclic ? '  [both ways]' : ''
      if (!out.push(`  ${edge.source} → ${edge.target} ×${edge.count}${cycle}`)) break
    }
  }
  const structure = projectStructure(graph)
  if (structure.hubFiles.length > 0) {
    out.push('')
    out.push('Most depended-on files in the project:')
    for (const hub of structure.hubFiles.slice(0, 8)) out.push(`  ${nodeLine(hub)}`)
  }
  if (structure.cycles.length > 0) {
    out.push('')
    out.push(`Import cycles: ${structure.cycles.length}. Largest:`)
    for (const cycle of structure.cycles.slice(0, 5)) {
      out.push(
        `  ${cycle.length} files: ${cycle
          .slice(0, 6)
          .map((id) => id.slice(5))
          .join(', ')}${cycle.length > 6 ? ', …' : ''}`,
      )
    }
  }
  return out.toString()
}

export function describeDetail(detail: NodeDetail, budget = DEFAULT_BUDGET): string {
  const out = new TextBudget(budget)
  const { node } = detail
  out.push(nodeLine(node))
  out.push(
    `In: ${
      detail.breadcrumb
        .slice(0, -1)
        .map((c) => c.name)
        .join(' / ') || '(root)'
    }`,
  )
  if (node.kind !== 'directory' && node.kind !== 'package') {
    out.push(`Files depending on it within 3 hops: ${detail.impactFiles}.`)
  }
  section(out, 'Outgoing', detail.outgoing, 'out', detail.moreOutgoing)
  section(out, 'Incoming', detail.incoming, 'in', detail.moreIncoming)
  return out.toString()
}

function section(
  out: TextBudget,
  title: string,
  relations: NodeDetail['incoming'],
  direction: 'in' | 'out',
  more: number,
) {
  out.push('')
  if (relations.length === 0) {
    out.push(`${title}: none resolved.`)
    return
  }
  out.push(`${title}:`)
  for (const relation of relations) {
    const label = EDGE_KIND_LABEL[relation.kind][direction]
    const times = relation.count > 1 ? ` ×${relation.count}` : ''
    if (!out.push(`  ${label}${times}: ${nodeLine(relation.node)}`)) return
  }
  if (more > 0) out.push(`  … ${more} more`)
}

export function describeImpact(
  graph: CodeGraph,
  subjectId: string,
  entries: ImpactEntry[],
  depth: number,
  budget = DEFAULT_BUDGET,
): string {
  const subject = graph.summary(subjectId)
  if (!subject) return `No node ${subjectId}.`
  const out = new TextBudget(budget)
  out.push(`${plural(entries.length, 'file')} depend on ${subject.name} within ${depth} hop(s):`)
  for (const entry of entries) {
    const symbols = entry.symbols
      .slice(0, 4)
      .map((s) => `${s.name}:${s.line ?? '?'}`)
      .join(', ')
    const more = entry.symbols.length > 4 ? ` +${entry.symbols.length - 4}` : ''
    if (
      !out.push(
        `  [${entry.distance}] ${location(entry.file)}${symbols ? ` — ${symbols}${more}` : ''}`,
      )
    )
      break
  }
  return out.toString()
}

export function describePath(steps: PathStep[] | null, from: string, to: string): string {
  if (!steps)
    return `No path from ${from} to ${to} within 8 hops. Try undirected: true to allow walking edges backwards.`
  return steps
    .map((step, index) => {
      const via = step.via
        ? `${step.reversed ? `(${EDGE_KIND_LABEL[step.via].in})` : step.via} `
        : ''
      return `${index === 0 ? '' : `  ${via}→ `}${nodeLine(step.node)}`
    })
    .join('\n')
}

function languages(stats: GraphStats): string {
  return (
    Object.entries(stats.languages)
      .map(([language, count]) => `${language} ${count}`)
      .join(', ') || 'none'
  )
}

function edgeCounts(stats: GraphStats): string {
  return (Object.entries(stats.edges) as Array<[EdgeKind, number]>)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ')
}

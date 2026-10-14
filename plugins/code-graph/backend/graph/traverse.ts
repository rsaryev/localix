import type { EdgeKind, NodeSummary } from '../../shared/model'
import type { CodeGraph } from './code-graph'

/**
 * Walks over the frozen graph: what a node touches, what depends on it transitively, and how two
 * nodes connect. A node always stands for everything under it — asking about a class includes its
 * methods, asking about a directory includes its files — because that is what "this" means to the
 * person pointing at it.
 */
export interface Relation {
  node: NodeSummary
  kind: EdgeKind
  count: number
  /** Line of the first occurrence, in the SOURCE's file. */
  line: number
}

export function subtree(graph: CodeGraph, id: string): Set<string> {
  const ids = new Set<string>([id])
  const stack = [id]
  while (stack.length > 0) {
    for (const child of graph.childrenOf(stack.pop() as string)) {
      ids.add(child)
      stack.push(child)
    }
  }
  return ids
}

/** The node an edge end is shown as: itself for a symbol subject, its file for a file or folder. */
function rollUp(graph: CodeGraph, id: string, toFile: boolean): string {
  if (!toFile) return id
  for (let at: string | null | undefined = id; at; at = graph.nodes.get(at)?.parent) {
    const kind = graph.nodes.get(at)?.kind
    if (kind === 'file' || kind === 'directory' || kind === 'package') return at
  }
  return id
}

export function relations(
  graph: CodeGraph,
  id: string,
): { incoming: Relation[]; outgoing: Relation[] } {
  const subject = graph.nodes.get(id)
  if (!subject) return { incoming: [], outgoing: [] }
  const inside = subtree(graph, id)
  const toFile = subject.kind === 'file' || subject.kind === 'directory'
  const incoming = new Map<string, Relation>()
  const outgoing = new Map<string, Relation>()
  const add = (
    into: Map<string, Relation>,
    other: string,
    kind: EdgeKind,
    count: number,
    line: number,
  ) => {
    const key = `${other}\u0000${kind}`
    const known = into.get(key)
    if (known) {
      known.count += count
      return
    }
    const node = graph.summary(other)
    if (node) into.set(key, { node, kind, count, line })
  }
  for (const member of inside) {
    for (const edge of graph.out(member)) {
      if (!inside.has(edge.target))
        add(outgoing, rollUp(graph, edge.target, toFile), edge.kind, edge.count, edge.line)
    }
    for (const edge of graph.in(member)) {
      if (!inside.has(edge.source))
        add(incoming, rollUp(graph, edge.source, toFile), edge.kind, edge.count, edge.line)
    }
  }
  const byWeight = (a: Relation, b: Relation) =>
    b.count - a.count || a.node.id.localeCompare(b.node.id)
  return {
    incoming: [...incoming.values()].sort(byWeight),
    outgoing: [...outgoing.values()].sort(byWeight),
  }
}

export interface ImpactEntry {
  /** The affected file, or package-less node when an edge starts outside any file. */
  file: NodeSummary
  /** Hops from the subject: 1 depends on it directly. */
  distance: number
  /** The symbols in that file that depend on the subject, nearest first. */
  symbols: NodeSummary[]
}

/**
 * Everything that depends on `id`, transitively, over every edge kind, grouped by file — the
 * "what breaks if I change this" question. Bounded by depth: past a few hops almost everything in
 * a real project depends on everything, and the answer stops being information.
 */
export function impact(graph: CodeGraph, id: string, maxDepth = 3): ImpactEntry[] {
  const inside = subtree(graph, id)
  const distance = new Map<string, number>()
  let frontier = [...inside]
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const at of frontier) {
      for (const edge of graph.in(at)) {
        if (inside.has(edge.source) || distance.has(edge.source)) continue
        distance.set(edge.source, depth)
        next.push(edge.source)
      }
    }
    frontier = next
  }
  const files = new Map<string, ImpactEntry>()
  for (const [nodeId, hops] of distance) {
    const fileId = rollUp(graph, nodeId, true)
    const file = graph.summary(fileId)
    if (!file) continue
    let entry = files.get(fileId)
    if (!entry) {
      entry = { file, distance: hops, symbols: [] }
      files.set(fileId, entry)
    }
    entry.distance = Math.min(entry.distance, hops)
    if (nodeId !== fileId) {
      const symbol = graph.summary(nodeId)
      if (symbol) entry.symbols.push(symbol)
    }
  }
  for (const entry of files.values()) entry.symbols.sort((a, b) => b.dependents - a.dependents)
  return [...files.values()].sort(
    (a, b) =>
      a.distance - b.distance ||
      b.file.dependents - a.file.dependents ||
      a.file.id.localeCompare(b.file.id),
  )
}

export interface PathStep {
  node: NodeSummary
  /** The edge that led here from the previous step; absent on the first. */
  via?: EdgeKind
  /** True when the edge was walked against its direction (only in an undirected search). */
  reversed?: boolean
}

/** The shortest chain of edges from `from` to `to`, following edge direction unless told not to. */
export function shortestPath(
  graph: CodeGraph,
  from: string,
  to: string,
  options: { undirected?: boolean; maxHops?: number } = {},
): PathStep[] | null {
  const maxHops = options.maxHops ?? 8
  const goal = subtree(graph, to)
  const start = subtree(graph, from)
  const previous = new Map<string, { from: string; via: EdgeKind; reversed: boolean } | null>()
  for (const id of start) previous.set(id, null)
  let frontier = [...start]
  for (let hops = 0; hops < maxHops && frontier.length > 0; hops += 1) {
    const next: string[] = []
    for (const at of frontier) {
      if (goal.has(at) && !start.has(at)) return unwind(graph, previous, at)
      const steps = [
        ...graph.out(at).map((edge) => ({ id: edge.target, via: edge.kind, reversed: false })),
        ...(options.undirected
          ? graph.in(at).map((edge) => ({ id: edge.source, via: edge.kind, reversed: true }))
          : []),
      ]
      for (const step of steps) {
        if (previous.has(step.id)) continue
        previous.set(step.id, { from: at, via: step.via, reversed: step.reversed })
        if (goal.has(step.id)) return unwind(graph, previous, step.id)
        next.push(step.id)
      }
    }
    frontier = next
  }
  return null
}

function unwind(
  graph: CodeGraph,
  previous: Map<string, { from: string; via: EdgeKind; reversed: boolean } | null>,
  end: string,
): PathStep[] {
  const steps: PathStep[] = []
  for (let at: string | undefined = end; at !== undefined;) {
    const link = previous.get(at)
    const node = graph.summary(at)
    if (node)
      steps.push(
        link ? { node, via: link.via, ...(link.reversed ? { reversed: true } : {}) } : { node },
      )
    at = link?.from
  }
  return steps.reverse()
}

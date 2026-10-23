import type { NodeSummary } from '../../shared/model'
import type { CodeGraph } from './code-graph'

/**
 * Whole-project facts that are expensive to find by hand and cheap to compute once per graph:
 * import cycles and the nodes the rest of the code leans on. Computed lazily and kept per graph —
 * a frozen graph never changes, so neither do they.
 */
export interface ProjectStructure {
  /** File-level import cycles (strongly connected components of two or more files), largest first. */
  cycles: string[][]
  /** Files the most other code depends on. */
  hubFiles: NodeSummary[]
  /** Symbols the most other code depends on. */
  hubSymbols: NodeSummary[]
}

const memo = new WeakMap<CodeGraph, ProjectStructure>()
const HUBS = 12

export function projectStructure(graph: CodeGraph): ProjectStructure {
  const known = memo.get(graph)
  if (known) return known
  const files: NodeSummary[] = []
  const symbols: NodeSummary[] = []
  for (const node of graph.nodes.values()) {
    if (node.kind === 'directory' || node.kind === 'package') continue
    const summary = graph.summary(node.id)
    if (!summary || summary.dependents === 0) continue
    ;(node.kind === 'file' ? files : symbols).push(summary)
  }
  const byDependents = (a: NodeSummary, b: NodeSummary) =>
    b.dependents - a.dependents || a.id.localeCompare(b.id)
  const structure: ProjectStructure = {
    cycles: importCycles(graph),
    hubFiles: files.sort(byDependents).slice(0, HUBS),
    hubSymbols: symbols.sort(byDependents).slice(0, HUBS),
  }
  memo.set(graph, structure)
  return structure
}

/**
 * Tarjan's strongly connected components over file → file imports, iteratively: a recursive walk
 * over a long import chain in a big project overflows the stack exactly where it is most needed.
 */
function importCycles(graph: CodeGraph): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0
  const successors = (id: string) =>
    graph
      .out(id)
      .filter((edge) => edge.kind === 'imports' && graph.nodes.get(edge.target)?.kind === 'file')
      .map((edge) => edge.target)

  for (const node of graph.nodes.values()) {
    if (node.kind !== 'file' || index.has(node.id)) continue
    const work: Array<{ id: string; next: string[]; at: number }> = []
    const open = (id: string) => {
      index.set(id, counter)
      low.set(id, counter)
      counter += 1
      stack.push(id)
      onStack.add(id)
      work.push({ id, next: successors(id), at: 0 })
    }
    open(node.id)
    while (work.length > 0) {
      const frame = work[work.length - 1] as { id: string; next: string[]; at: number }
      const successor = frame.next[frame.at]
      if (successor !== undefined) {
        frame.at += 1
        if (!index.has(successor)) open(successor)
        else if (onStack.has(successor)) {
          low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(successor) ?? 0))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.id, Math.min(low.get(parent.id) ?? 0, low.get(frame.id) ?? 0))
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = []
        let member: string | undefined
        do {
          member = stack.pop()
          if (member === undefined) break
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.id)
        if (component.length > 1) components.push(component.sort())
      }
    }
  }
  return components.sort((a, b) => b.length - a.length || (a[0] ?? '').localeCompare(b[0] ?? ''))
}

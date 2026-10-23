import { dirId, fileId } from '../shared/ids'
import type { NodeSummary } from '../shared/model'
import { nodeLine } from '../shared/format'
import type { CodeGraph } from './graph/code-graph'
import { resolveNodeRef } from './graph/search'

/**
 * A node as the agent (or a URL) names it: the id every answer prints, a project path, or a name.
 * Accepting all three matters because models copy what they last read, and they read paths in
 * file tools and names in code; making them translate would trade a lookup for a wrong guess.
 */
export interface NodeRef {
  node: NodeSummary
  /** Set when a name matched several nodes equally well; the answer lists them. */
  note?: string
}

export function findNode(graph: CodeGraph, ref: string): NodeRef | null {
  const text = ref.trim().replace(/^\.\//, '').replace(/\/$/, '')
  for (const candidate of [text, fileId(text), dirId(text)]) {
    const node = graph.summary(candidate)
    if (node) return { node }
  }
  const resolved = resolveNodeRef(graph, text)
  if (!resolved) return null
  if (resolved.alternatives.length === 0) return { node: resolved.node }
  return {
    node: resolved.node,
    note: [
      `"${ref}" matched several nodes; answering for the first. Pass an id to choose another:`,
      ...resolved.alternatives.map((alt) => `  ${nodeLine(alt)}`),
    ].join('\n'),
  }
}

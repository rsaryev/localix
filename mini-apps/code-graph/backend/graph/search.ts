import type { NodeKind, NodeSummary } from '../../shared/model'
import type { CodeGraph } from './code-graph'

/**
 * Find nodes by what a person or a model would type: a name, part of one, a path.
 *
 * Lexical on purpose — no embeddings, nothing to download, the same answer every time. Tiers rank
 * an exact name above a prefix above a substring above a path hit, and inside a tier the node more
 * of the project depends on comes first: of fifty `index.ts` files, the one everything imports is
 * the one being asked about.
 */
export interface SearchOptions {
  kinds?: readonly NodeKind[]
  limit?: number
  scope?: string
}

export interface SearchHit {
  node: NodeSummary
  score: number
}

export function searchNodes(
  graph: CodeGraph,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const limit = options.limit ?? 20
  const kinds = options.kinds?.length ? new Set(options.kinds) : null
  // `Client.send` and `client/send` narrow by qualified name or path; a bare word matches names.
  const qualified = needle.includes('.') || needle.includes('/') || needle.includes('#')
  const words = needle.split(/\s+/u)
  const hits: Array<{ id: string; tier: number }> = []

  for (const node of graph.nodes.values()) {
    if (kinds && !kinds.has(node.kind)) continue
    if (options.scope && !graph.within(node.id, options.scope)) continue
    const name = node.name.toLowerCase()
    const short = name.slice(name.lastIndexOf('.') + 1)
    let tier = 0
    if (node.id.toLowerCase() === needle) tier = 5
    else if (name === needle || short === needle) tier = 4
    else if (name.startsWith(needle) || short.startsWith(needle)) tier = 3
    else if (name.includes(needle)) tier = 2
    else if (qualified && `${node.path}#${name}`.toLowerCase().includes(needle)) tier = 1
    else if (
      words.length > 1 &&
      words.every((word) => `${node.path}#${name}`.toLowerCase().includes(word))
    )
      tier = 1
    if (tier > 0) hits.push({ id: node.id, tier })
  }

  return hits
    .map(({ id, tier }) => {
      const node = graph.summary(id) as NodeSummary
      // The dependents term breaks ties inside a tier and never lifts a node across one.
      return { node, score: tier + Math.min(node.dependents, 9999) / 10000 }
    })
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .slice(0, limit)
}

export interface ResolvedRef {
  node: NodeSummary
  /** Other nodes in the winning tier: the answer names them so a wrong pick is visible. */
  alternatives: NodeSummary[]
}

/**
 * A node a tool call or a URL names: its exact id, else the best search hit. An id is what every
 * result prints, so a model that copies one gets exactly that node. A name is a convenience, and
 * when several nodes match equally well the others come back too — the caller says so instead of
 * silently answering about a namesake.
 */
export function resolveNodeRef(graph: CodeGraph, ref: string): ResolvedRef | null {
  const exact = graph.summary(ref.trim())
  if (exact) return { node: exact, alternatives: [] }
  const hits = searchNodes(graph, ref, { limit: 5 })
  const [best, ...rest] = hits
  if (!best) return null
  const tier = Math.floor(best.score)
  return {
    node: best.node,
    alternatives: rest.filter((hit) => Math.floor(hit.score) === tier).map((hit) => hit.node),
  }
}

import type { CallSite, EdgeKind, GraphEdge, GraphNode, NodeSummary } from '../../shared/model'

/**
 * The project graph in memory: nodes, both adjacency directions and the containment tree.
 *
 * Built whole from the cached extractions on every change and never patched in place — a rebuild
 * is milliseconds, and a graph that is only ever assembled from its inputs cannot drift from them.
 * After `freeze()` it is read-only, so a query can hold a reference while the next build runs.
 */
export class CodeGraph {
  readonly nodes = new Map<string, GraphNode>()
  readonly children = new Map<string, string[]>()
  private readonly outgoing = new Map<string, GraphEdge[]>()
  private readonly incoming = new Map<string, GraphEdge[]>()
  private readonly edgeIndex = new Map<string, GraphEdge>()
  private readonly rollup = new Map<string, { dependents: number; dependencies: number }>()
  private readonly filesUnder = new Map<string, number>()
  private readonly sites = new Map<string, CallSite[]>()
  private frozen = false

  /** Records where a resolved call is written inside `source`, for the code card's links. */
  addCallSite(source: string, site: CallSite): void {
    if (!this.frozen && source !== site.target) push(this.sites, source, site)
  }

  callSites(id: string): readonly CallSite[] {
    return this.sites.get(id) ?? []
  }

  private readonly refs = new Map<string, CallSite[]>()

  /** Records a resolved name use in a file (a type, a constant, `ns.helper`) for code cards. */
  addRefSite(fileId: string, site: CallSite): void {
    if (!this.frozen) push(this.refs, fileId, site)
  }

  refSites(fileId: string): readonly CallSite[] {
    return this.refs.get(fileId) ?? []
  }

  addNode(node: GraphNode): void {
    if (this.frozen || this.nodes.has(node.id)) return
    this.nodes.set(node.id, node)
    if (node.parent) {
      const siblings = this.children.get(node.parent)
      if (siblings) siblings.push(node.id)
      else this.children.set(node.parent, [node.id])
    }
  }

  /** Adds an edge, or counts one more occurrence of an existing one. Self-edges are dropped. */
  addEdge(source: string, target: string, kind: EdgeKind, line: number): void {
    if (this.frozen || source === target) return
    const key = `${source}\u0000${target}\u0000${kind}`
    const known = this.edgeIndex.get(key)
    if (known) {
      known.count += 1
      return
    }
    const edge: GraphEdge = { source, target, kind, line, count: 1 }
    this.edgeIndex.set(key, edge)
    push(this.outgoing, source, edge)
    push(this.incoming, target, edge)
  }

  get edgeCount(): number {
    return this.edgeIndex.size
  }

  edges(): IterableIterator<GraphEdge> {
    return this.edgeIndex.values()
  }

  out(id: string): readonly GraphEdge[] {
    return this.outgoing.get(id) ?? []
  }

  in(id: string): readonly GraphEdge[] {
    return this.incoming.get(id) ?? []
  }

  childrenOf(id: string): readonly string[] {
    return this.children.get(id) ?? []
  }

  /** The node and its ancestors, innermost first. */
  ancestry(id: string): string[] {
    const chain: string[] = []
    for (let at: string | null | undefined = id; at; at = this.nodes.get(at)?.parent) {
      chain.push(at)
    }
    return chain
  }

  /** Whether `id` is `ancestor` or lies under it. */
  within(id: string, ancestor: string): boolean {
    for (let at: string | null | undefined = id; at; at = this.nodes.get(at)?.parent) {
      if (at === ancestor) return true
    }
    return false
  }

  /**
   * Freeze and compute each node's rolled-up counts: an edge between two nodes counts for every
   * ancestor of either end BELOW their lowest common ancestor — the edge crosses that ancestor's
   * boundary. Inside the common ancestor it is internal and counts for neither.
   */
  freeze(): this {
    if (this.frozen) return this
    for (const edge of this.edgeIndex.values()) {
      const sourceChain = this.ancestry(edge.source)
      const targetChain = this.ancestry(edge.target)
      const shared = new Set(sourceChain)
      const common = targetChain.find((id) => shared.has(id))
      for (const id of targetChain) {
        if (id === common) break
        this.counts(id).dependents += edge.count
      }
      for (const id of sourceChain) {
        if (id === common) break
        this.counts(id).dependencies += edge.count
      }
    }
    for (const node of this.nodes.values()) {
      if (node.kind !== 'file') continue
      for (let at = node.parent; at; at = this.nodes.get(at)?.parent ?? null) {
        this.filesUnder.set(at, (this.filesUnder.get(at) ?? 0) + 1)
      }
    }
    for (const siblings of this.children.values()) siblings.sort()
    this.frozen = true
    return this
  }

  summary(id: string): NodeSummary | null {
    const node = this.nodes.get(id)
    if (!node) return null
    const counts = this.rollup.get(id)
    return {
      ...node,
      dependents: counts?.dependents ?? 0,
      dependencies: counts?.dependencies ?? 0,
      size: this.sizeOf(node),
    }
  }

  private sizeOf(node: GraphNode): number {
    if (node.kind === 'directory') return this.filesUnder.get(node.id) ?? 0
    return this.childrenOf(node.id).length
  }

  private counts(id: string) {
    let counts = this.rollup.get(id)
    if (!counts) {
      counts = { dependents: 0, dependencies: 0 }
      this.rollup.set(id, counts)
    }
    return counts
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

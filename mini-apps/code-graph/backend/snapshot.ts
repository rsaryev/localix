import { basename } from 'node:path'
import { ROOT_DIR_ID } from '../shared/ids'
import type { NodeSummary } from '../shared/model'
import type { CodeGraph } from './graph/code-graph'
import { subtree } from './graph/traverse'
import type { GraphSnapshot } from '../shared/view'
import { readAgentView } from './agent-view'
import { searchNodes } from './graph/search'
import { projectStructure } from './graph/structure'
import { graphView, nodeDetail } from './graph/view'
import type { ProjectIndex } from './indexing/project-index'
import { buildLens } from './lens'

/**
 * The view's snapshot for what it is looking at. A request names a scope, a selected node and a
 * search; each is answered from the published graph, and a name the graph no longer has (the file
 * was deleted since) falls back to the root rather than failing the whole poll.
 */
export interface ViewQuery {
  sessionId?: string
  scope?: string
  node?: string
  q?: string
  external?: boolean
  /** Functions opened in the call lens, first to last; the lens is shown when there are any. */
  trail?: string[]
  /**
   * The tab hears this project's file changes (`POST /changed`), so a poll need not check for
   * them itself.
   */
  live?: boolean
}

/**
 * How stale a poll may find the graph before it starts a freshness check — a full walk and a stat
 * of every source file. Without a change signal that is the only way an edit is noticed, so it
 * stays short. With one, every poll older than 10 s was a walk spent confirming nothing changed;
 * the check is then only a backstop for what the watcher cannot see.
 */
const POLL_FRESHNESS_MS = 10_000
const LIVE_FRESHNESS_MS = 5 * 60_000

export async function buildSnapshot(index: ProjectIndex, query: ViewQuery): Promise<GraphSnapshot> {
  index.touch(query.live ? LIVE_FRESHNESS_MS : POLL_FRESHNESS_MS)
  const published = index.current
  const agent = readAgentView(index.root, query.sessionId)
  const snapshot: GraphSnapshot = {
    project: basename(index.root),
    root: index.root,
    status: index.snapshot(),
    ...(agent ? { agent } : {}),
  }
  if (!published) return snapshot
  const { graph, stats } = published
  const scope = query.scope && graph.nodes.has(query.scope) ? query.scope : ROOT_DIR_ID
  const view = graphView(graph, scope, { external: query.external })
  const lens = query.trail?.length
    ? await buildLens(graph, index.root, query.trail, (path) => index.cachedHash(path))
    : null
  // In the lens, the inspector follows the function you are reading unless something is selected.
  const standing = lens?.trail.at(-1)?.node.id ?? scope
  const selected = query.node && graph.nodes.has(query.node) ? query.node : standing
  const selection = nodeDetail(graph, selected)
  const structure = projectStructure(graph)
  return {
    ...snapshot,
    stats,
    ...(view ? { view } : {}),
    ...(lens ? { lens } : {}),
    ...(selection ? { selection } : {}),
    ...(query.q
      ? { search: searchNodes(graph, query.q, { limit: 12 }).map((hit) => hit.node) }
      : {}),
    cycles: structure.cycles
      .filter((cycle) => cycle.some((id) => graph.within(id, scope)))
      .slice(0, 8),
    hubs: hubsUnder(graph, scope),
  }
}

/** The files under `scope` the most code depends on — the level's own hotspots, not the project's. */
function hubsUnder(graph: CodeGraph, scope: string): NodeSummary[] {
  const files: NodeSummary[] = []
  for (const id of subtree(graph, scope)) {
    const node = graph.nodes.get(id)
    if (node?.kind !== 'file') continue
    const summary = graph.summary(id)
    if (summary && summary.dependents > 0) files.push(summary)
  }
  return files.sort((a, b) => b.dependents - a.dependents || a.id.localeCompare(b.id)).slice(0, 8)
}

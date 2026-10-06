// Pure forest-building helpers for the runtime sessions panel, extracted from
// RuntimeSessionsPanel so the nesting/ordering logic is isolated and testable.
import type { UiSession } from '@/shared/api/contracts'

/** A node in the runtime session forest, flattened to a render-ready preorder row. */
export interface FlatNode {
  session: UiSession
  depth: number
  /** Whether to draw a vertical guide line for each ancestor column (length = depth - 1 once the connector is added). */
  prefixCols: boolean[]
  /** True when this node is the last child of its parent (renders a `└` elbow instead of `├`). */
  isLast: boolean
  childCount: number
}

interface TreeNode {
  session: UiSession
  children: TreeNode[]
}

// Newest-CREATED first (the just-spawned worker/reviewer rises to the top), stable:
// createdAt is immutable so rows never jump as sessions tick (never by updatedAt /
// last-message). Ties broken by id, descending, to stay deterministic.
const byRecency = (a: UiSession, b: UiSession) =>
  b.createdAt - a.createdAt || b.id.localeCompare(a.id)

/**
 * Build a forest from the flat runtime-session list using `parentSessionId`.
 * A session whose parent is NOT in the list is a root here — its parent is the
 * main chat session that owns this panel, so roots are the top-level sub-agents.
 */
function buildForest(sessions: UiSession[]): TreeNode[] {
  const ids = new Set(sessions.map((s) => s.id))
  const childrenByParent = new Map<string, UiSession[]>()
  const roots: UiSession[] = []
  for (const session of sessions) {
    const parent = session.parentSessionId
    if (parent && ids.has(parent)) {
      const arr = childrenByParent.get(parent)
      if (arr) arr.push(session)
      else childrenByParent.set(parent, [session])
    } else {
      roots.push(session)
    }
  }
  const build = (session: UiSession): TreeNode => ({
    session,
    children: (childrenByParent.get(session.id) ?? []).sort(byRecency).map(build),
  })
  return roots.sort(byRecency).map(build)
}

/** Preorder-flatten the forest, carrying the guide-line state each row needs to draw. */
function flattenForest(forest: TreeNode[], collapsedIds: ReadonlySet<string>): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (node: TreeNode, depth: number, prefixCols: boolean[], isLast: boolean) => {
    out.push({ session: node.session, depth, prefixCols, isLast, childCount: node.children.length })
    if (collapsedIds.has(node.session.id)) return
    // Children inherit this node's ancestor columns plus one for this node's own
    // branch: a vertical line continues past this node only if it has siblings below.
    const childPrefix = depth === 0 ? [] : [...prefixCols, !isLast]
    node.children.forEach((child, i) =>
      walk(child, depth + 1, childPrefix, i === node.children.length - 1),
    )
  }
  forest.forEach((root, i) => walk(root, 0, [], i === forest.length - 1))
  return out
}

/** Build the render-ready preorder tree (forest → flat rows) from a flat session list. */
export function buildRuntimeSessionTree(
  sessions: UiSession[],
  collapsedIds: ReadonlySet<string> = new Set(),
): FlatNode[] {
  return flattenForest(buildForest(sessions), collapsedIds)
}

/** WHICH DELEGATED CHILDREN ARE STILL RUNNING below a session. */
import type { RunSessionSnapshotRow } from './session-snapshot'

/**
 * The running descendants of one session — its whole subtree, never anything above it — as the
 * READER should see them.
 *
 * The subtree, because what a delegation put in motion is the reader's to know: a grandchild still
 * working is why its child has not reported yet. Indented under its owner (`↳`), because seeing is
 * not managing — a deeper run is its owner's to message or stop (`agent-control.ts`).
 */
export function activeDescendantSubagents(
  sessions: readonly RunSessionSnapshotRow[],
  parentId: string,
) {
  const byParent = new Map<string, RunSessionSnapshotRow[]>()
  for (const candidate of sessions) {
    if (!candidate.parentSessionId || candidate.sessionKind !== 'subagent') continue
    const children = byParent.get(candidate.parentSessionId) ?? []
    children.push(candidate)
    byParent.set(candidate.parentSessionId, children)
  }
  const out: Array<{ title: string; task?: string }> = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const child of byParent.get(id) ?? []) {
      if (child.runtimeStatus === 'running') {
        out.push({
          title: `${'↳ '.repeat(depth)}${child.title} [${child.runtimeStatus}]`,
          task: child.id,
        })
      }
      visit(child.id, depth + 1)
    }
  }
  visit(parentId, 0)
  return out
}

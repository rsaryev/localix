/**
 * WHICH DELEGATED CHILDREN ARE STILL RUNNING, AND WHOSE THEY ARE.
 *
 * Its own module because the second half of that question only appeared when a conversation
 * could hold several agents, and it is the half that is easy to get wrong: a room's members
 * share one session, so "children of this session" is not "my children". Told otherwise, a
 * member reads a colleague's delegated work as its own — and the section's advice ("do not
 * re-delegate the same task") then points it at work it
 * never started.
 */
import type { RunSessionSnapshotRow } from './session-snapshot'

/**
 * The running descendants of one session — its whole subtree, never anything above it — as the
 * READER should see them.
 *
 * The subtree, because what a delegation put in motion is the reader's to know: a grandchild still
 * working is why its child has not reported yet. Indented under its owner (`↳`), because seeing is
 * not managing — a deeper run is its owner's to message or stop (`agents-control.ts`).
 *
 * `viewer` is the participant taking this turn, and it changes what the roster MEANS. A room's
 * members share one session, so without it every member was told that every colleague's
 * delegated child was its own — and the section's advice ("do not re-delegate the same task",
 * "wait for its one-shot result") then pointed a member at work it never started. Whose child it is
 * comes from the child's own provenance, stamped when it was created.
 */
export function activeDescendantSubagents(
  sessions: readonly RunSessionSnapshotRow[],
  parentId: string,
  viewer?: string,
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
        // Attributed only when there is somebody else it could belong to. In a private chat
        // every child is the one agent's, and saying "yours" on every line says nothing.
        const owner =
          viewer && 'parentParticipant' in child.provenance
            ? child.provenance.parentParticipant
            : undefined
        const whose =
          !viewer || !owner ? '' : owner === viewer ? ' (yours)' : ` (${ownerWord(owner)})`
        out.push({
          title: `${'↳ '.repeat(depth)}${child.title} [${child.runtimeStatus}]${whose}`,
          task: child.id,
        })
      }
      visit(child.id, depth + 1)
    }
  }
  visit(parentId, 0)
  return out
}

/** A participant ref as a roster line names it: `@handle` where there is one. */
function ownerWord(participant: string): string {
  return participant.startsWith('agent:')
    ? `@${participant.slice('agent:'.length).replace(/^builtin:/, '')}`
    : participant
}

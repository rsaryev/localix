import type { ChatRepository } from '../repository'

/**
 * The reach of an operator Stop, kept apart from the stop itself: enumerating a session's
 * spawned children is a different concern from ending one run, and folding it in pushed
 * `stop-session.ts` past the repo's file-size ratchet.
 */
export interface CascadeContext {
  repo: Pick<ChatRepository, 'listChildSessionIds'>
  /** Stop one child, carrying the cycle guard down with it. */
  stop: (sessionId: string, visited: Set<string>) => Promise<unknown>
}

/**
 * Stop the sessions this one spawned, depth-first.
 *
 * A spawned child runs DETACHED: `task-delegation` launches it through `runJobTask` with no
 * signal from the parent, so it gets its own run under its own id. That independence is
 * deliberate for an ordinary turn — a child's report is still wanted by whatever runs next
 * in the parent — but it is wrong for an OPERATOR stop: the person who would have read that
 * report just asked for the work to end, and a child left running keeps spending tokens,
 * keeps mutating files, and keeps holding its concurrency lane with nobody waiting for it.
 *
 * `deleteSession` already cascades for exactly this reason ("otherwise background processes
 * outlive the session"); a stop needs the same reach.
 *
 * The parent is aborted BEFORE this runs, which is what makes the enumeration sound: a live
 * parent could otherwise spawn one more child after we listed them, and that one would
 * survive the stop.
 *
 * `visited` guards against a corrupted parent chain: a cycle must not turn Stop into a hang.
 */
export async function stopSpawnedChildren(
  ctx: CascadeContext,
  userId: string,
  parentId: string,
  visited: Set<string>,
): Promise<void> {
  // Defensive on BOTH failure shapes: a composition without the full repository throws
  // synchronously (not a function), a live one can reject. Enumerating children is
  // auxiliary — never a reason for Stop itself to fail.
  const childIds = await (async () => {
    try {
      return await ctx.repo.listChildSessionIds(userId, parentId)
    } catch {
      return [] as string[]
    }
  })()
  await Promise.all(
    childIds
      .filter((childId) => !visited.has(childId))
      .map(async (childId) => {
        visited.add(childId)
        // Children are independent of each other, so they stop in parallel; each one
        // recurses, because a child of a child is just as detached.
        await ctx.stop(childId, visited).catch(() => {})
      }),
  )
}

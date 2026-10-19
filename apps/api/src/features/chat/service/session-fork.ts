import { randomUUID } from 'node:crypto'

import { forkSessionTitle } from '../session-title'
import { chosenRoute } from '../session-route'
import { walkPathToRoot, indexMessageTree } from './branching'
import { messageNotFound, type BranchingOpsContext } from './branching-ops'
import { toSessionSummary, type SessionRecord } from '../repository'
import type { SessionDetail } from '../contracts'

/**
 * Copy a conversation into a brand-new chat session. The history copied is
 * the path root → `fromMessageId` (or root → current leaf when omitted), so
 * forking from a past message clones only up to that point. The new session
 * inherits the source's model/provider/mode/project and links back to it via
 * `parentSessionId` (+ shared `rootSessionId`) so the breadcrumb chain shows
 * the lineage. Messages are deep-copied with fresh ids — the two sessions are
 * fully independent after the fork.
 *
 * Its own module beside `branching-ops.ts` because it answers a different question: those
 * operations move the active branch of ONE session under its mutation lock, while a fork reads a
 * session and writes a second one, and takes no lock on either.
 */
export async function forkSession(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  fromMessageId?: string,
): Promise<SessionDetail> {
  const { repo, now } = ctx
  const source = await ctx.requireSession(userId, sessionId)
  const nodes = await repo.listMessageNodes(userId, sessionId)
  const { parentById, msgById } = indexMessageTree(nodes)

  const tipId = fromMessageId ?? (await repo.getSessionLeaf(sessionId))
  if (fromMessageId && !msgById.has(fromMessageId)) {
    throw messageNotFound()
  }

  // Walk the chosen tip up to the root, then copy in chronological order.
  const pathIds = walkPathToRoot(parentById, tipId ?? null)

  const timestamp = now()
  const { seq, id: forkedId } = await repo.allocateSessionRef(userId)
  const forked: SessionRecord = {
    id: forkedId,
    seq,
    userId,
    title: forkSessionTitle(source.title, seq),
    goal: source.goal ?? null,
    previousTopicSummary: source.previousTopicSummary ?? null,
    isPinned: false,
    projectId: source.projectId,
    parentSessionId: source.id,
    rootSessionId: source.rootSessionId ?? source.id,
    sessionKind: 'chat',
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    provenance: { kind: 'fork', parentSessionId: source.id },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    executionBackend: source.executionBackend,
    executionTarget: source.executionTarget,
    pinnedSkills: source.pinnedSkills,
    // A fork is the same conversation with the same people, each still on the model they were
    // on — but only what the SOURCE chose is copied as a choice (`chosenRoute`). A model the
    // source was merely inheriting resolves the same way for the fork, and stays inherited
    // instead of being frozen into the branch at the moment it was taken.
    agents: source.agents.map(chosenRoute),
    description: source.description,
    avatar: source.avatar,
    // A branch inherits the tools its source had already put on the wire; re-activating them would
    // be the first thing the model had to do otherwise.
    activatedTools: source.activatedTools,
    archivedAt: null,
    // The fork joins its source's tree, and a tree runs under one mode: its root's, which a
    // change there writes to every session of the tree. Born on the default instead, a fork of a
    // plan-mode conversation could write files until the root's mode next changed.
    ...(source.permissionMode ? { permissionMode: source.permissionMode } : {}),
    // The same conversation with the same people works the same way: solo stays solo.
    ...(source.conversationMode ? { conversationMode: source.conversationMode } : {}),
  }
  await repo.insertSession(forked)

  // Linear copy: insertMessage attaches each new message under the current
  // leaf and advances it, so the forked session is a single straight branch.
  for (const id of pathIds) {
    const orig = msgById.get(id)
    if (!orig) continue
    const newId = randomUUID()
    await repo.insertMessage({
      id: newId,
      sessionId: forked.id,
      userId,
      payload: { ...orig.payload, id: newId },
      createdAt: orig.createdAt,
      updatedAt: orig.updatedAt,
    })
  }

  ctx.streamRegistry.publish(userId, forked.id, {
    type: 'session.updated',
    session: toSessionSummary(await ctx.requireSession(userId, forked.id)),
  })
  return ctx.getSessionDetail(userId, forked.id)
}

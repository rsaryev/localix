import { ApiError } from '../../../lib/errors'
import { previewBranchPayload, walkPathToRoot, indexMessageTree } from './branching'
import {
  messageNotFound,
  withBranchMutation,
  type BranchingOpsContext,
} from './branching-ops-context'
import type { SessionBranchTree, SessionDetail } from '../contracts'

export async function switchBranch(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  messageId: string,
  branchIndex: number,
): Promise<SessionDetail> {
  const { repo } = ctx
  return withBranchMutation(ctx, userId, sessionId, async () => {
    // Tree-native: `messageId` is the currently-shown sibling at a branch point;
    // `branchIndex` is the target sibling (children of the same parent, ordered
    // by sequence). Move the active leaf to the deepest leaf of that sibling's
    // subtree so listMessages returns the chosen branch.
    const siblings = await repo.siblings(sessionId, messageId)
    const targetId = siblings[branchIndex]
    if (!targetId) {
      throw new ApiError(404, 'branch_not_found', 'Branch not found')
    }
    const newLeaf = await repo.descendToLeaf(sessionId, targetId)
    await repo.setSessionLeaf(sessionId, newLeaf)
    return ctx.getSessionDetail(userId, sessionId)
  })
}

/** Full message tree (all branches) + active path, for the branch-tree UI. */
export async function getBranchTree(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
): Promise<SessionBranchTree> {
  const { repo } = ctx
  await ctx.requireSession(userId, sessionId)
  const [nodes, leafId] = await Promise.all([
    repo.listMessageNodes(userId, sessionId),
    repo.getSessionLeaf(sessionId),
  ])

  const { parentById } = indexMessageTree(nodes)
  const activePath = walkPathToRoot(parentById, leafId)

  return {
    sessionId,
    leafId,
    activePath,
    nodes: nodes.map(({ message, parentId }) => ({
      id: message.id,
      parentId,
      role: message.payload.role,
      preview: previewBranchPayload(message.payload),
      createdAt: message.createdAt,
      ...(message.payload.isInternal ? { isInternal: true } : {}),
    })),
  }
}

/**
 * Jump the active branch to ANY message in the tree (not just a sibling of
 * the currently shown one): the leaf moves to the deepest descendant of the
 * target, so listMessages returns that whole branch.
 */
export async function checkoutBranch(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<SessionDetail> {
  const { repo } = ctx
  return withBranchMutation(ctx, userId, sessionId, async () => {
    const target = await repo.getMessage(userId, sessionId, messageId)
    if (!target) throw messageNotFound()
    const newLeaf = await repo.descendToLeaf(sessionId, messageId)
    await repo.setSessionLeaf(sessionId, newLeaf)
    return ctx.getSessionDetail(userId, sessionId)
  })
}

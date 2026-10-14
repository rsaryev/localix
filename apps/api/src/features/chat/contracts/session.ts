import { z } from 'zod'

import { REASONING_EFFORTS } from '../../../db/types'
import { PERMISSION_MODES } from '../../capabilities/permission-modes'
import { modelIdSchema, providerConnectionIdSchema } from '../../catalog/model-identity'
import { SESSION_TITLE_MAX_CHARS } from '../session-limits'
import { sessionTopicSchema } from '../../agent-core/session-topic'

const sharedTopicFields = {
  goal: sessionTopicSchema.shape.goal.nullable().optional(),
  previousTopicSummary: sessionTopicSchema.shape.previousTopicSummary.nullable().optional(),
}

export const reasoningEffortSchema = z.enum(REASONING_EFFORTS)
export const sessionKindSchema = z.enum(['chat', 'subagent', 'job', 'system'])

export const runtimeStatusSchema = z.enum(['idle', 'running', 'completed', 'failed', 'stopped'])

/** Public creation is intentionally root-chat-only; strict rejects forged lineage fields. */
export const createSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_CHARS).optional(),
    ...sharedTopicFields,
    providerConnectionId: providerConnectionIdSchema.nullable().optional(),
    modelId: modelIdSchema.optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
    projectId: z.string().nullable().optional(),
    /**
     * WHO THE CHAT IS WITH — registry AgentIds, in join order, which is also the order they
     * speak in. Absent means the default agent, which is what an ordinary "new chat" means and
     * why this is not required.
     *
     * One entry is a private chat and several are a group: the difference is the length of this
     * list and nothing else, because a room is the same session with more participants. The cap
     * is the conversation's, not the storage's — a transcript every member re-reads before its
     * turn costs a member's context window per member, so a room that grows without bound
     * stops being readable long before it stops being writable.
     */
    externalAgentProvider: z.string().min(1).max(64).optional(),
    agentIds: z.array(z.string().trim().min(1).max(200)).optional(),
  })
  .strict()

/**
 * Import an outside conversation as a real session.
 *
 * `items` is checked for SHAPE, not for the full `AgentItem` union: the union is large and lives in
 * `@localixai/agent`, so a zod mirror here would be a second definition that drifts from the first
 * one silently. What the boundary actually has to guarantee is that the payload is storable and
 * bounded — an id and a type per item, and a cap on how much arrives at once.
 */
const importedItemSchema = z
  .object({ id: z.string().min(1).max(256), type: z.string().min(1).max(64) })
  .passthrough()

export const importSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_CHARS),
    projectId: z.string().nullable().optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(1_000_000).optional(),
            items: z.array(importedItemSchema).max(2_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5_000),
  })
  .strict()

export const sessionParamsSchema = z.object({
  id: z.string().min(1),
})

export const messageParamsSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
})

export const branchParamsSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
})

export const switchBranchRequestSchema = z.object({
  branchIndex: z.number().int().min(0),
})

export const checkoutBranchRequestSchema = z.object({
  messageId: z.string().min(1),
})

export const forkSessionRequestSchema = z.object({
  /** Fork the history up to this message; omitted → up to the current leaf. */
  messageId: z.string().min(1).optional(),
})

/**
 * One node of the session message tree (ALL branches, not just the active one).
 * Read-only view model for the branch-tree UI: previews are truncated, payloads
 * are not included.
 */
export interface SessionBranchNode {
  id: string
  /** Tree parent (null for a root message). */
  parentId: string | null
  role: string
  /** First ~120 chars of the message text (single line). */
  preview: string
  createdAt: string
  /** System-generated messages (for example a wake's hidden prompt row) — UI renders them dimmed. */
  isInternal?: boolean
}

export interface SessionBranchTree {
  sessionId: string
  /** Current branch tip (matches the session's leaf pointer), null when empty. */
  leafId: string | null
  /** Message ids on the active branch, root → leaf. */
  activePath: string[]
  /** Every message in the session, ordered by sequence (insertion order). */
  nodes: SessionBranchNode[]
}

/**
 * Re-route ONE participant of a conversation.
 *
 * A model belongs to an agent inside a conversation, not to the conversation: a group runs
 * several at once. So the choice names whom it is for. An omitted `agentId` means the session's
 * own participant, which is unambiguous in a private chat and is the first member in a group —
 * that default is what lets an existing single-agent client keep sending what it always sent.
 */
export const sessionRouteRequestSchema = z.object({
  agentId: z.string().min(1).max(200).optional(),
  providerConnectionId: providerConnectionIdSchema.nullable().optional(),
  modelId: modelIdSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
})

export const updateSessionRequestSchema = z.object({
  ...sharedTopicFields,
  externalAgentSessionKey: z.string().min(3).max(400).optional(),
  externalAgentProvider: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(SESSION_TITLE_MAX_CHARS).optional(),
  route: sessionRouteRequestSchema.optional(),
  /**
   * Replace the participants — add or remove, in the order they will speak.
   *
   * Whole-list, not a diff: the service reseats the list as one write that preserves the
   * surviving participants' own routes (`reseatParticipants`), so a client that sends the
   * membership it wants cannot half-apply a change the way an add/remove pair can.
   */
  agentIds: z.array(z.string().trim().min(1).max(200)).optional(),
  /**
   * The session's `updatedAt` the list above was built from. A session changed since — an agent
   * invited someone, another window edited it — refuses the list with 409 `session_changed`
   * instead of erasing that change.
   */
  expectedUpdatedAt: z.string().min(1).max(64).optional(),
  /**
   * Fix the participants (true) or leave them open (false). Accepted only before the
   * conversation starts; afterwards it is 409 `conversation_started` (`roster-lock.ts`).
   */
  rosterLocked: z.boolean().optional(),
  /** The conversation's permission mode; accepted on a root conversation only (children inherit). */
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  runtimeStatus: runtimeStatusSchema.optional(),
})

/** Runtime/client capabilities used for descriptor-level tool availability. */
export const clientToolSurfaceSchema = z.object({
  capabilities: z.array(z.string().min(1)).max(32),
  catalogs: z
    .record(z.string().min(1), z.string().min(1).max(128))
    .refine((value) => Object.keys(value).length <= 16, 'Too many capability catalogs')
    .optional(),
})

export const editMessageRequestSchema = z.object({
  content: z.string().min(1),
  /** Capabilities of the client surface initiating the edited-message rerun. */
  toolSurface: clientToolSurfaceSchema.optional(),
})

/** Regeneration starts a fresh run and therefore carries the same client surface as send. */
export const regenerateRequestSchema = z.object({
  toolSurface: clientToolSurfaceSchema.optional(),
  /**
   * The assistant reply the caller means to regenerate (a failure row's Retry). Checked under the
   * session's mutation lock: when it is no longer the latest reply the request is refused (409)
   * instead of rewriting whatever reply came after it.
   */
  expectedMessageId: z.string().min(1).max(200).optional(),
})

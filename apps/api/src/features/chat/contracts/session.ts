import { z } from 'zod'

import { REASONING_EFFORTS } from '../../../db/types'
import { PERMISSION_MODES } from '../../../contracts/permission-modes'
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
    externalAgentProvider: z.string().min(1).max(64).optional(),
    /** The registry AgentId the chat is with, fixed for its life. Absent means the default agent. */
    agentId: z.string().trim().min(1).max(200).optional(),
    /**
     * A landing (the neutral home, a launch, a window leaving a dead project) rather than the
     * New chat gesture: answer with the project's newest untouched chat when one exists, so
     * every window that lands at once converges on one chat instead of one each.
     */
    reuseEmptyDraft: z.boolean().optional(),
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

/** Re-route the conversation's agent: the model it runs on, never who it is. */
export const sessionRouteRequestSchema = z.object({
  providerConnectionId: providerConnectionIdSchema.nullable().optional(),
  modelId: modelIdSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
})

export const updateSessionRequestSchema = z
  .object({
    ...sharedTopicFields,
    externalAgentSessionKey: z.string().min(3).max(400).optional(),
    externalAgentProvider: z.string().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_CHARS).optional(),
    route: sessionRouteRequestSchema.optional(),
    /** The conversation's permission mode; accepted on a root conversation only (children inherit). */
    permissionMode: z.enum(PERMISSION_MODES).optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    projectId: z.string().nullable().optional(),
    runtimeStatus: runtimeStatusSchema.optional(),
  })
  .strict()

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

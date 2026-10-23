/**
 * A PERSON'S COMMENT ON SOMETHING, KEPT ON THE SERVER.
 *
 * Review comments lived only in the client's memory (`@localixai/mini-app-sdk/ui` comments
 * store): a reload, a crash or simply not pressing the one button that carried them lost every
 * one. They are durable rows now, and generic on purpose — the server does not know what a
 * comment points at. It knows two things:
 *
 *   scope    what the comment is ABOUT, as `<kind>:<id>` (`plan:<id>`). Comments are listed and
 *            sent per scope; the owner of a kind deletes its scope's comments with the subject.
 *   anchor   WHERE in the subject, as an opaque JSON object only the client's surface reads. A
 *            plan's anchors carry `{ quote, prefix, suffix }`; a reader that needs a line of
 *            text from an anchor uses {@link anchorQuote}, never a surface-specific field.
 *
 * Status is the comment's lifecycle, not its content:
 *
 *   open      written, not yet handed to anyone;
 *   sent      delivered with a review — kept, so the person can see what the agent was told;
 *   outdated  the subject changed under it (the client could no longer place the anchor).
 */
import { z } from 'zod'

export const COMMENT_STATUSES = ['open', 'sent', 'outdated'] as const
export type CommentStatus = (typeof COMMENT_STATUSES)[number]

export interface CommentRecord {
  id: string
  userId: string
  scope: string
  anchor: Record<string, unknown>
  body: string
  status: CommentStatus
  createdAt: string
  updatedAt: string
}

/** What the routes answer — the owner is the caller, so it is not repeated. */
export type CommentView = Omit<CommentRecord, 'userId'>

export const COMMENT_BODY_MAX = 10_000
/** Serialized; an anchor is a locator, not a copy of the subject. */
export const COMMENT_ANCHOR_MAX = 4_000

/** `<kind>:<id>` — a lowercase kind, then an id of the characters ids are made of. */
export const commentScopeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9_.:-]{1,200}$/u, 'scope must be <kind>:<id>')

const anchorSchema = z
  .record(z.string(), z.unknown())
  .refine((anchor) => JSON.stringify(anchor).length <= COMMENT_ANCHOR_MAX, {
    message: `anchor exceeds ${COMMENT_ANCHOR_MAX} characters`,
  })

const bodySchema = z.string().trim().min(1).max(COMMENT_BODY_MAX)

export const listCommentsQuerySchema = z.object({ scope: commentScopeSchema })

export const createCommentSchema = z.object({
  scope: commentScopeSchema,
  anchor: anchorSchema,
  body: bodySchema,
})

export const updateCommentSchema = z
  .object({ body: bodySchema.optional(), status: z.enum(COMMENT_STATUSES).optional() })
  .refine((patch) => patch.body !== undefined || patch.status !== undefined, {
    message: 'Nothing to change: name body or status',
  })

export const commentParamsSchema = z.object({ id: z.string().min(1).max(100) })

/** The scope of a plan's comments — the one place the `plan:` kind is spelled. */
export const planCommentScope = (planId: string) => `plan:${planId}`

/** The line of the subject a comment is about, when its anchor carries one. */
export function anchorQuote(anchor: Record<string, unknown>): string | undefined {
  for (const key of ['quote', 'context', 'label']) {
    const value = anchor[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

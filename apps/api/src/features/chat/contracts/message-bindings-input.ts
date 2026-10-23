import { z } from 'zod'
import path from 'node:path'

import type {
  MessageAttachment,
  MessageBinding,
  MessageContextBinding,
  MessageInvocationBinding,
} from '@localixai/agent'
import { bindingsTotalBytes, MAX_MESSAGE_BINDINGS_TOTAL_BYTES } from './message-binding-bytes'

/**
 * What a message may CARRY, as it arrives on the wire: files, context links, invocations —
 * and the cap the whole set is held to.
 *
 * Apart from `messages.ts` (which owns the send request) so the binding rules stay a leaf: that
 * module imports the session contract, and this one imports nothing of either, so any other
 * turn-starting contract can reuse the same cap without closing a cycle.
 */

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

/**
 * A file attached to a message. Bytes ride EITHER inline as base64 `data` (user
 * uploads, legacy messages) OR by reference to a stored file via `mediaId` (loaded
 * from `/rpc/media/:id`); text & code files are pre-extracted to `text` and
 * inlined into the prompt. The inferred type matches `MessageAttachment` from
 * `@localixai/agent` (the canonical persisted shape) — enforced via `satisfies` below.
 */
export const messageAttachmentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('path'),
      path: z
        .string()
        .min(1)
        .max(4096)
        .refine(
          (value) =>
            path.isAbsolute(value) &&
            path.normalize(value) === value &&
            !hasControlCharacters(value),
          'Attachment path must be an absolute normalized path without control characters',
        ),
      mediaType: z.string().min(1).max(255),
      name: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (value) => !hasControlCharacters(value),
          'Attachment name must not contain control characters',
        ),
      size: z.number().int().nonnegative(),
    })
    .refine((value) => path.basename(value.path) === value.name, {
      message: 'Attachment name must match the absolute path basename',
      path: ['name'],
    }),
  z.object({
    kind: z.literal('image'),
    mediaType: z.string().min(1),
    data: z.string().min(1).optional(),
    mediaId: z.string().min(1).optional(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('video'),
    mediaType: z.string().min(1),
    data: z.string().min(1).optional(),
    mediaId: z.string().min(1).optional(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('file'),
    mediaType: z.string().min(1),
    data: z.string().min(1).optional(),
    mediaId: z.string().min(1).optional(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('audio'),
    mediaType: z.string().min(1),
    data: z.string().min(1).optional(),
    mediaId: z.string().min(1).optional(),
    name: z.string(),
    size: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    name: z.string(),
    text: z.string(),
    size: z.number().int().nonnegative(),
    spilled: z.boolean().optional(),
    path: z.string().optional(),
    lineCount: z.number().int().nonnegative().optional(),
    contextRef: z.boolean().optional(),
  }),
]) satisfies z.ZodType<MessageAttachment>

export type { MessageAttachment }

const messageBindingSourceSchema = z.enum([
  'upload',
  'mention',
  'drag',
  'active-tab',
  'slash',
  'mini-app',
  'system',
])
const messageBindingStatusSchema = z.enum([
  'pending',
  'resolved',
  'empty',
  'unsupported',
  'out_of_scope',
  'denied',
  'timeout',
  'deadline_exceeded',
  'aborted',
  'error',
])
const messageBindingContributionSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  providerVersion: z.string().min(1),
  scope: z.enum(['document', 'project', 'session', 'global']),
  kind: z.string().min(1),
  content: z.string(),
  revision: z.string().optional(),
  sensitivity: z.enum(['public', 'project', 'sensitive', 'forbidden']),
})
export const messageContextBindingSchema = z.object({
  kind: z.literal('context'),
  id: z.string().min(1),
  source: messageBindingSourceSchema,
  assets: z.array(messageAttachmentSchema).max(8).optional(),
  miniApp: z
    .string()
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/iu)
    .optional(),
  target: z.object({
    kind: z.string().min(1),
    token: z.string().min(1),
    label: z.string().min(1),
    uri: z.string().optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
  resolution: z.object({
    status: messageBindingStatusSchema,
    capturedAt: z.string().optional(),
    contributions: z.array(messageBindingContributionSchema),
  }),
}) satisfies z.ZodType<MessageContextBinding>
export const messageInvocationBindingSchema = z.object({
  kind: z.literal('invocation'),
  id: z.string().min(1),
  source: z.enum(['slash', 'plugin', 'system']),
  invocation: z.object({
    kind: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string().optional(),
    lifetime: z.enum(['turn', 'session']),
  }),
  presentation: z.object({
    label: z.string().min(1),
    token: z.string().optional(),
  }),
  instruction: z.string().optional(),
}) satisfies z.ZodType<MessageInvocationBinding>
export const messageBindingSchema: z.ZodType<MessageBinding> = z.union([
  messageAttachmentSchema,
  messageContextBindingSchema,
  messageInvocationBindingSchema,
])
export type { MessageBinding, MessageContextBinding, MessageInvocationBinding }

/**
 * The binding array as it may arrive on ANY turn-starting request. One schema, so a second
 * entry point cannot quietly
 * accept a different cap than the one the socket's payload limit is sized against.
 */
export const messageBindingsSchema = z
  .array(messageBindingSchema)
  .max(20)
  .refine((bindings) => bindingsTotalBytes(bindings) <= MAX_MESSAGE_BINDINGS_TOTAL_BYTES, {
    message: 'Message bindings exceed the total size limit',
  })

import { z } from 'zod'

import { secretKeySchema, vaultItemTypeSchema } from './contracts'

/**
 * WHAT THE MODEL IS SHOWN: one flat object, every field once.
 *
 * The per-action union below used to BE the wire schema, and a discriminated union renders as
 * one JSON object per branch — the 27-value item-type enum three times, the key pattern five
 * times — ~960 tokens on every request of every chat, the third-largest schema in the roster.
 * The union still decides what a call means (`vaultActionSchema`, parsed in `execute`); the
 * wire only has to say which fields exist.
 */
export const vaultInputSchema = z
  .object({
    action: z
      .enum(['list', 'get', 'create', 'update', 'rotate', 'delete'])
      .describe(
        'list/get read metadata. create/rotate ask the user for the value in a masked prompt; update edits metadata; delete asks the user to approve.',
      ),
    key: secretKeySchema.optional().describe('The item alias. Required except for list.'),
    query: z.string().max(120).optional().describe('list: text filter.'),
    type: vaultItemTypeSchema.optional(),
    title: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    expected_version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The version from get/list. Required for update, rotate and delete.'),
    reason: z
      .string()
      .max(500)
      .optional()
      .describe('Shown to the user. Required for create, rotate and delete.'),
  })
  .strict()

const listActionSchema = z
  .object({
    action: z.literal('list'),
    query: z.string().trim().max(120).optional(),
    type: vaultItemTypeSchema.optional(),
  })
  .strict()

const getActionSchema = z
  .object({
    action: z.literal('get'),
    key: secretKeySchema,
  })
  .strict()

const createActionSchema = z
  .object({
    action: z.literal('create'),
    key: secretKeySchema,
    reason: z.string().trim().min(1).max(500),
    type: vaultItemTypeSchema.default('secret'),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict()

const updateActionSchema = z
  .object({
    action: z.literal('update'),
    key: secretKeySchema,
    expected_version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    type: vaultItemTypeSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.type === undefined &&
      input.tags === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'At least one metadata field must be provided',
      })
    }
  })

const rotateActionSchema = z
  .object({
    action: z.literal('rotate'),
    key: secretKeySchema,
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

const deleteActionSchema = z
  .object({
    action: z.literal('delete'),
    key: secretKeySchema,
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

/** What a call MEANS: the per-action contract `execute` enforces over the flat wire input. */
export const vaultActionSchema = z.discriminatedUnion('action', [
  listActionSchema,
  getActionSchema,
  createActionSchema,
  updateActionSchema,
  rotateActionSchema,
  deleteActionSchema,
])

export type VaultToolInput = z.infer<typeof vaultActionSchema>
export type VaultWireInput = z.infer<typeof vaultInputSchema>

import { z } from 'zod'
import { LANGUAGES, NODE_KINDS } from './model'

/**
 * A node as every snapshot part carries it — the level, the lens, the inspector. Its own module
 * because both the view contract and the lens contract build on it, and neither may import the
 * other.
 */
/** One step of a path through the tree; the kind lets a breadcrumb show what each step is. */
export const crumbSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(NODE_KINDS).optional(),
})

export const nodeSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  name: z.string(),
  path: z.string(),
  parent: z.string().nullable(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  exported: z.boolean().optional(),
  language: z.enum(LANGUAGES).optional(),
  dependents: z.number(),
  dependencies: z.number(),
  size: z.number(),
})

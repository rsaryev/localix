import { z } from 'zod'

// Route-local request schemas for chat endpoints whose shape is not shared with
// the rest of the chat contracts (usage analytics, skill authoring, and the whole
// file-browser surface). Kept out of routes.ts so that file holds only route
// wiring. Pure data, no behavior. (The file-browser RESPONSE shapes are the
// contract half — they live in file-contracts.ts.)

export const usageOverviewQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(['model', 'provider', 'kind', 'agent']).optional(),
  bucket: z.enum(['hour', 'day']).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  session: z.string().optional(),
  agent: z.string().optional(),
})

export const usageLogsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  session: z.string().optional(),
  agent: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const skillInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'Use letters, numbers, dashes or underscores'),
  description: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  projectId: z.string().nullable().optional(),
})

// ── File browser (viewer/editor, explorer tree, search panel) ──────────────────

export const fileReadQuerySchema = z.object({
  path: z.string().min(1),
  /** The editor requests the complete file (no view truncation) so a save can't write
   *  back a partial buffer; the read returns a `hash` token too. */
  full: z.enum(['1', 'true']).optional(),
  /** Conditional read: the hash the client already holds. When it still matches the
   *  file on disk the response is `{ unchanged: true }` with an empty body. */
  knownHash: z.string().min(1).optional(),
})

export const fileWriteRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** sha256 of the content the editor loaded; 409 if the file drifted. */
  baseHash: z.string().min(1),
})

export const treeQuerySchema = z.object({ path: z.string().optional() })

export const fileCreateRequestSchema = z.object({
  parentPath: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['file', 'dir']),
})

export const fileRenameRequestSchema = z.object({
  path: z.string().min(1),
  newName: z.string().min(1),
})

export const filePasteRequestSchema = z.object({
  source: z.string().min(1),
  destDir: z.string().min(1),
  mode: z.enum(['move', 'copy']),
})

export const fileDeleteRequestSchema = z.object({
  path: z.string().min(1),
  permanent: z.boolean().optional(),
})

/** A bare target path — shared by file-duplicate and file-reveal. */
export const filePathRequestSchema = z.object({ path: z.string().min(1) })

export const fileSearchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  mode: z.enum(['fuzzy', 'regex']).optional(),
  type: z.enum(['all', 'files', 'folders']).optional(),
  /** Comma-separated extension list (e.g. "ts,tsx"). */
  ext: z.string().optional(),
  /** Surface files a parent repo's .gitignore hides (container-of-clones). */
  includeIgnored: z.coerce.boolean().optional(),
})

export const contentSearchQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  regex: z.coerce.boolean().optional(),
  caseSensitive: z.coerce.boolean().optional(),
  wholeWord: z.coerce.boolean().optional(),
  glob: z.string().optional(),
  excludeGlob: z.string().optional(),
  contextLines: z.coerce.number().int().min(0).max(3).optional(),
  /** Search inside files a parent repo's .gitignore hides (container-of-clones). */
  includeIgnored: z.coerce.boolean().optional(),
})

export const replaceContentRequestSchema = z.object({
  q: z.string().min(1),
  replacement: z.string(),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  glob: z.string().optional(),
  excludeGlob: z.string().optional(),
  /** Replace inside files a parent repo's .gitignore hides, matching search. */
  includeIgnored: z.boolean().optional(),
})

// Inline request shapes formerly declared next to their handlers in routes.ts.

export const historySearchQuerySchema = z.object({
  q: z.string(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export const skillScopeQuerySchema = z.object({ projectId: z.string().optional() })

export const sessionSkillsRequestSchema = z.object({ skills: z.array(z.string()) })

export const sessionQuerySchema = z.object({
  // Thin clients load only the newest N messages; messageCount in the
  // response carries the full total so "load earlier" knows more exist.
  messageLimit: z.coerce.number().int().positive().max(5000).optional(),
  toolDetails: z.literal('deferred').optional(),
})

export const reactionRequestSchema = z.object({ emoji: z.string().min(1).max(16) })

export const pinRequestSchema = z.object({ pinned: z.boolean() })

export const messageTaskRequestSchema = z.object({
  key: z.string().min(1).max(200),
  checked: z.boolean(),
})

export const stopMonitorRequestSchema = z.object({ monitorId: z.string().min(1) })

export const loopIdRequestSchema = z.object({ id: z.string().min(1) })

export const queueItemRequestSchema = z.object({ itemId: z.string().min(1) })
/** `wholeBatch`: remove every item delivered together with this one (a `batched` refusal). */
export const queueRemoveRequestSchema = queueItemRequestSchema.extend({
  wholeBatch: z.boolean().optional(),
})

import { z } from 'zod'

import { projectSchema } from './contracts'

/**
 * The wire shapes of a project's folder: its status (`GET /projects/:id/folder`) and moving the
 * project to where the folder went (`POST /projects/:id/relocate`). See `relocate.ts`.
 */
export const workspaceFolderStateSchema = z.enum([
  'present',
  'missing',
  'not_a_directory',
  'unreadable',
])

export const projectFolderResponseSchema = z.object({
  /** The folder the project records. */
  path: z.string(),
  state: workspaceFolderStateSchema,
  /** Where the folder went, when that is certain; the client offers it, never applies it. */
  suggestion: z.string().nullable(),
})

export const relocateProjectRequestSchema = z.object({
  /** The absolute path of the folder the project now lives in. */
  path: z.string().min(1),
})

export const relocateProjectResponseSchema = z.object({
  project: projectSchema,
  /** Claude Code's auto memory: copied from the old path, kept (the new path had its own), none. */
  memory: z.enum(['copied', 'kept', 'none']),
  /** Whether Claude Code trusted the old folder and trusts the new one. Never carried over. */
  trust: z.object({ before: z.boolean(), after: z.boolean() }),
})

export type ProjectFolderResponse = z.infer<typeof projectFolderResponseSchema>
export type RelocateProjectResponse = z.infer<typeof relocateProjectResponseSchema>

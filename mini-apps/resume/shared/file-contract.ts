import { z } from 'zod'
import { documentSchema, idSchema, resumeSchema } from './schema'

export const RESUME_DIR = '.localix/resumes'
export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/u)
export const resumeFileSchema = resumeSchema.omit({ revision: true })
export const actorSchema = z.enum(['user', 'agent', 'external'])
export const revisionRecordSchema = z.strictObject({
  revision: revisionSchema,
  recordedAt: z.iso.datetime(),
  actor: actorSchema,
  label: z.string().max(500),
  document: documentSchema,
})
export type RevisionRecord = z.infer<typeof revisionRecordSchema>
export function resumePath(id: string): string {
  return `${RESUME_DIR}/${idSchema.parse(id)}/resume.json`
}

import { idSchema } from './schema'

export const RESUME_ROOT = 'localix://resource/resume'
export function resumeUri(id: string, sectionId?: string): string {
  idSchema.parse(id)
  if (sectionId) idSchema.parse(sectionId)
  return `${RESUME_ROOT}/${id}${sectionId ? `/section/${sectionId}` : ''}`
}
export function parseResumeUri(uri: string): { id: string; sectionId?: string } | null {
  const match = /^localix:\/\/resource\/resume\/([^/]+)(?:\/section\/([^/]+))?$/u.exec(uri)
  if (
    !match ||
    !idSchema.safeParse(match[1]).success ||
    (match[2] && !idSchema.safeParse(match[2]).success)
  )
    return null
  return { id: match[1]!, ...(match[2] ? { sectionId: match[2] } : {}) }
}

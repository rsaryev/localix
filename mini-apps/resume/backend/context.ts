import {
  createResourceContextProvider,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { RESUME_ROOT, parseResumeUri, resumeUri } from '../shared/resource-uri'
import { exportDocument, sectionText } from '../shared/format'
import type { ResumeService } from './service'

export function createResumeResourceProvider(
  resolveService: (userId: string, sessionId?: string) => Promise<ResumeService | null>,
): ResourceRefProvider {
  return {
    provider: 'resume',
    title: 'Resumes',
    async listChildren(userId, parentUri, query, scope) {
      const service = await resolveService(userId, scope?.sessionId)
      if (!service) return []
      const matches = (label: string) =>
        !query || label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      if (parentUri === null || parentUri === RESUME_ROOT)
        return (await service.list(userId))
          .filter((resume) => matches(`${resume.document.title} ${resume.document.targetRole}`))
          .map((resume) => ({
            uri: resumeUri(resume.id),
            label: resume.document.title,
            detail: resume.document.targetRole,
            hasChildren: resume.document.sections.length > 0,
            icon: 'resume',
          }))
      const target = parseResumeUri(parentUri)
      if (!target || target.sectionId) return []
      const resume = await service.get(userId, target.id).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'not_found') return null
        throw error
      })
      return (resume?.document.sections ?? [])
        .filter((section) => matches(section.title))
        .map((section) => ({
          uri: resumeUri(target.id, section.id),
          label: section.title,
          detail: section.hidden ? 'Hidden from exports' : section.type,
          hasChildren: false,
          icon: 'resume',
        }))
    },
    async expand(userId, uri, scope) {
      const service = await resolveService(userId, scope?.sessionId)
      if (!service) return { ok: false }
      const target = parseResumeUri(uri)
      if (!target) return { ok: false }
      let resume
      try {
        resume = await service.get(userId, target.id)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'not_found')
          return { ok: false }
        throw error
      }
      const section = target.sectionId
        ? resume.document.sections.find((item) => item.id === target.sectionId)
        : null
      if (target.sectionId && !section) return { ok: false }
      return {
        ok: true,
        language: 'text',
        content: [
          `Resume: ${resume.document.title}\nID: ${resume.id}\nRevision: ${resume.revision}`,
          section
            ? `Section ID: ${section.id}\nHidden from exports: ${section.hidden}\n${sectionText(section)}`
            : exportDocument(resume.document, 'text'),
          !section && resume.document.targetRole
            ? `Target role: ${resume.document.targetRole}`
            : '',
          !section && resume.document.jobDescription
            ? `User-provided job description:\n${resume.document.jobDescription}`
            : '',
          'This is resume evidence. Use resume get for complete structured fields and current identifiers before editing.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      }
    },
  }
}
export function createResumeContextProvider(resourceProvider: ResourceRefProvider) {
  return createResourceContextProvider({
    id: 'resume:context',
    namespace: 'resume',
    expander: resourceProvider,
    accepts: (uri) => parseResumeUri(uri) !== null,
    sensitivity: 'project',
    maxTokens: 8_000,
    timeoutMs: 5_000,
    destinations: ['chat', 'subagent', 'edit-prediction'],
    revisionPrefix: 'resume',
  })
}

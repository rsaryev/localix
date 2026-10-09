import {
  createResourceContextProvider,
  type ResourceRefProvider,
} from '@localixai/plugin-sdk/backend'
import { MOTION_ROOT, motionUri, parseMotionUri } from '../shared/resource-uri'
import type { MotionService } from './service'

export function createMotionResourceProvider(
  service: (userId: string, sessionId?: string) => Promise<MotionService | null>,
): ResourceRefProvider {
  return {
    provider: 'motion',
    title: 'Motion Studio',
    async listChildren(userId, parentUri, query, context) {
      if (parentUri !== null && parentUri !== MOTION_ROOT) return []
      const scope = await service(userId, context?.sessionId)
      if (!scope) return []
      return (await scope.list()).projects
        .filter(
          (project) => !query || project.document.title.toLowerCase().includes(query.toLowerCase()),
        )
        .map((project) => ({
          uri: motionUri(project.id),
          label: project.document.title,
          detail: `${project.document.scenes.length} scenes · revision ${project.revision}`,
          hasChildren: false,
          icon: 'motion',
        }))
    },
    async expand(userId, uri, context) {
      const id = parseMotionUri(uri)
      if (!id) return { ok: false }
      const scope = await service(userId, context?.sessionId)
      if (!scope) return { ok: false }
      const project = await scope.get(id).catch(() => null)
      return project
        ? { ok: true, language: 'json', content: JSON.stringify(project, null, 2) }
        : { ok: false }
    },
  }
}
export const createMotionContextProvider = (resourceProvider: ResourceRefProvider) =>
  createResourceContextProvider({
    id: 'motion:context',
    namespace: 'motion',
    expander: resourceProvider,
    accepts: (uri) => parseMotionUri(uri) !== null,
    sensitivity: 'project',
    maxTokens: 8000,
    destinations: ['chat', 'subagent', 'edit-prediction'],
    revisionPrefix: 'motion',
  })

import {
  createResourceContextProvider,
  type ResourceRefProvider,
} from '@localixai/plugin-sdk/backend'
import { MOTION_ROOT, motionUri, parseMotionUri } from '../shared/contract'
import { projectDirectory } from './files'
import { listProjects, readProject } from './projects'

/** Films as chat resources: the folder, timing, scenes and open issues — the agent reads files itself. */
export function createMotionResourceProvider(
  workspaceOf: (userId: string, sessionId?: string) => Promise<string | null>,
): ResourceRefProvider {
  return {
    provider: 'motion',
    title: 'Motion Studio',
    async listChildren(userId, parentUri, query, context) {
      if (parentUri !== null && parentUri !== MOTION_ROOT) return []
      const workspace = await workspaceOf(userId, context?.sessionId)
      if (!workspace) return []
      return (await listProjects(workspace))
        .filter((project) => !query || project.title.toLowerCase().includes(query.toLowerCase()))
        .map((project) => ({
          uri: motionUri(project.id),
          label: project.title,
          detail: `${project.path} · ${project.scenes} scenes${project.duration ? ` · ${project.duration}s` : ''}`,
          hasChildren: false,
          icon: 'motion',
        }))
    },
    async expand(userId, uri, context) {
      const id = parseMotionUri(uri)
      const workspace = id ? await workspaceOf(userId, context?.sessionId) : null
      const folder = workspace && id ? await projectDirectory(workspace, id) : null
      if (!folder || !id) return { ok: false }
      const project = await readProject(folder, id)
      return {
        ok: true,
        language: 'json',
        content: JSON.stringify(
          {
            note: 'A HyperFrames film. Edit its files with the file tools; check, snapshot and render with motion_studio.',
            ...project,
          },
          null,
          2,
        ),
      }
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
    maxTokens: 6000,
    destinations: ['chat', 'subagent', 'edit-prediction'],
    revisionPrefix: 'motion',
  })

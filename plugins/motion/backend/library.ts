import type { MotionLibrary } from '../shared/contract'
import { projectDirectory } from './files'
import { detectTooling, jobFor } from './jobs'
import { listProjects, readProject } from './projects'
import { viewBase } from './view'

export interface Scope {
  userId: string
  sessionId: string
  workspace: string
}

/** The whole library for one conversation, with live jobs and signed view paths. */
export async function libraryOf(scope: Scope, focus?: string): Promise<MotionLibrary> {
  const [projects, tooling] = await Promise.all([listProjects(scope.workspace), detectTooling()])
  const withJobs = await Promise.all(
    projects.map(async (project) => {
      const folder = await projectDirectory(scope.workspace, project.id)
      return {
        ...project,
        view: viewBase(scope.userId, scope.sessionId, project.id),
        job: folder ? jobFor(folder) : null,
      }
    }),
  )
  return { projects: withJobs, tooling, ...(focus ? { focus } : {}) }
}

export async function projectOf(scope: Scope, id: string) {
  const folder = await projectDirectory(scope.workspace, id)
  if (!folder) return null
  return {
    folder,
    project: {
      ...(await readProject(folder, id)),
      view: viewBase(scope.userId, scope.sessionId, id),
      job: jobFor(folder),
    },
  }
}

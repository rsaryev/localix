import { backendClient } from '@/shared/api/client'
import type { Project } from '@/shared/api/contracts'

/**
 * The model new chats start on, stored where the model chain reads it: the default project's
 * `settings.providerConnectionId` / `settings.modelId` (the `project` level of the route chain).
 */
export interface DefaultModel {
  providerConnectionId: string
  modelId: string
}

/** The project an unassigned choice belongs to, or nothing while the list has not arrived. */
export function defaultProject(projects: readonly Project[]): Project | null {
  return projects.find((project) => project.isDefault) ?? projects[0] ?? null
}

/** The stored pair, or null when either half is missing — half a route does not run. */
export function defaultModelOf(project: Project | null): DefaultModel | null {
  const providerConnectionId = project?.settings?.providerConnectionId
  const modelId = project?.settings?.modelId
  return providerConnectionId && modelId ? { providerConnectionId, modelId } : null
}

/** Record the pair on the project and hand back the project as stored. */
export function saveDefaultModel(projectId: string, choice: DefaultModel): Promise<Project> {
  return backendClient.patchProjectSettings(projectId, choice)
}

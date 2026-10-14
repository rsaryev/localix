/**
 * THE MODEL NEW CHATS START ON — read and written where it lives, on the project.
 *
 * Onboarding's provider step asks one question ("pick the model your chats start with") and has
 * to answer it in a place three things can see: the step after it, the workspace's first chat,
 * and the same machine tomorrow. It used to answer in localStorage, which is none of those — it
 * is per-browser, and it outlives the database, so a recreated `~/.localix/localix.db` left the
 * app naming a provider connection that no longer existed.
 *
 * A project's settings already ARE this answer: `settings.modelId` / `settings.providerConnectionId`
 * are the `project` level of the model chain (`agent-route-resolution.ts`), consulted for every
 * session that does not carry an explicit choice of its own. Writing there means the setup step
 * configures the same field the project settings screen shows, and a database that is deleted
 * takes the project and its default with it — nothing is left pointing at nothing.
 *
 * The DEFAULT project, specifically: onboarding runs before there is any other, and it is where
 * an unassigned session lands (`projects/default-project.ts`, `Project.isDefault`).
 */
import { backendClient } from '@/shared/api/client'
import type { Project } from '@/shared/api/contracts'

export interface StartupModel {
  providerConnectionId: string
  modelId: string
}

/** The project a first-run choice belongs to, or nothing when the list has not arrived yet. */
export function startupProject(projects: readonly Project[]): Project | null {
  return projects.find((project) => project.isDefault) ?? projects[0] ?? null
}

/**
 * The pair a project starts its chats on, or null when either half is missing.
 *
 * BOTH halves or nothing: a model with no connection cannot run, and a connection with no model
 * leaves the first chat unwired, so a half-written setting is not a route.
 *
 * Callers that must tell the two failures apart read {@link startupHalvesOf} instead — the
 * activation summary says "connected, but no model picked yet", which needs the connection on
 * its own.
 */
export function startupModelOf(project: Project | null): StartupModel | null {
  const { providerConnectionId, modelId } = startupHalvesOf(project)
  return modelId && providerConnectionId ? { providerConnectionId, modelId } : null
}

/** The two halves as stored, each possibly absent. */
export function startupHalvesOf(project: Project | null): {
  providerConnectionId: string | null
  modelId: string | null
} {
  return {
    providerConnectionId: project?.settings?.providerConnectionId ?? null,
    modelId: project?.settings?.modelId ?? null,
  }
}

/** Record the pair on the project, and hand back the project as stored. */
export async function saveStartupModel(projectId: string, choice: StartupModel): Promise<Project> {
  return backendClient.patchProjectSettings(projectId, {
    modelId: choice.modelId,
    providerConnectionId: choice.providerConnectionId,
  })
}

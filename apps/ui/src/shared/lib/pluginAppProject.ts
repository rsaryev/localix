import { backendClient } from '@/shared/api/client'

/**
 * A plugin app's project: the folder the shell made for it (`~/.localix/apps/<plugin>`), found or
 * created like any project, by its directory, and named after the app the first time.
 *
 * Installing makes it, so an app always opens into a project of its own; the app's window asks
 * again on launch, which finds the same project (or brings back one that was deleted).
 */
export async function ensurePluginAppProject(projectDir: string, name: string): Promise<string> {
  const { project, created } = await backendClient.resolveProjectByPath(projectDir)
  if (created && project.name !== name) await backendClient.updateProject(project.id, { name })
  return project.id
}

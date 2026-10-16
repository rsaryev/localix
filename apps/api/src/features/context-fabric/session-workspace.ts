import type { ResolveContext } from './contracts'

/**
 * The trusted workspace a session's context is contained in: the session's effective root plus
 * the user's and project's `contextExclusions`.
 *
 * One owner for every destination. Edit prediction had this and chat send did not, so a user's
 * exclusion applied to the editor's context and not to a file they linked in a message. Every
 * caller that resolves references through Context Fabric now mints its workspace here.
 */
export interface SessionWorkspacePorts {
  resolveSessionWorkspaceMetadata(
    userId: string,
    sessionId: string,
  ): Promise<{ rootPath: string; projectId: string | null }>
  getProfile(userId: string): Promise<{
    agentSettings?: { contextExclusions?: string[] } | null
  }>
  getProject(
    userId: string,
    projectId: string,
  ): Promise<{ settings?: { contextExclusions?: string[] } | null } | null>
}

export async function resolveContextWorkspace(
  ports: SessionWorkspacePorts,
  userId: string,
  sessionId: string,
): Promise<NonNullable<ResolveContext['workspace']>> {
  const [workspace, profile] = await Promise.all([
    ports.resolveSessionWorkspaceMetadata(userId, sessionId),
    ports.getProfile(userId),
  ])
  const project = workspace.projectId
    ? await ports.getProject(userId, workspace.projectId).catch(() => null)
    : null
  const excludedRelativePaths = [
    ...new Set([
      ...(profile.agentSettings?.contextExclusions ?? []),
      ...(project?.settings?.contextExclusions ?? []),
    ]),
  ]
  return { rootPath: workspace.rootPath, excludedRelativePaths }
}

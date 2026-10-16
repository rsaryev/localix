/** Namespace is registry ownership, not a handle or an execution role. */
export const nativeAgentIdPrefix = (projectId: string): string =>
  projectId ? `native:project:${encodeURIComponent(projectId)}:` : 'native:global:'

export const createNativeAgentId = (projectId: string): string =>
  `${nativeAgentIdPrefix(projectId)}${crypto.randomUUID()}`

export const belongsToNativeScope = (id: string, projectId: string): boolean => {
  const prefix = nativeAgentIdPrefix(projectId)
  return id.startsWith(prefix) && id.length > prefix.length
}

/**
 * Whether a catalog entry of `entryProjectId` is visible in `scope`: its own scope, or the
 * installation's, which every project lists beneath its own definitions (`discoverAgents`).
 */
export const visibleInScope = (entryProjectId: string, scope: string): boolean =>
  entryProjectId === scope || entryProjectId === ''

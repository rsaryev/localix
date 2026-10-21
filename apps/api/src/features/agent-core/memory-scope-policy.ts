/** One scope policy for prompt recall, tool reads, and the tool's mutation classifier. */
export type MemoryScope = 'session' | 'project' | 'global'

export function memoryScopePolicy(
  projectId?: string | null,
  sessionId?: string,
  selection?: MemoryScope,
) {
  const targets = {
    session: sessionId ? `session:${sessionId}` : undefined,
    project: projectId || undefined,
    global: '',
  }
  const scopes = selection
    ? targets[selection] === undefined
      ? []
      : [targets[selection]!]
    : [
        ...new Set(
          [targets.session, targets.project, ''].filter((s): s is string => s !== undefined),
        ),
      ]
  return {
    scopes,
    revision: JSON.stringify([selection ?? 'all', scopes]),
    target(requested?: MemoryScope): string {
      if (selection && requested && requested !== selection) {
        throw new Error(`This agent's memory scope is ${selection}.`)
      }
      const scope = requested ?? selection
      const target = scope ? targets[scope] : (targets.project ?? targets.session ?? '')
      if (target === undefined)
        throw new Error(`Memory scope ${scope} is unavailable in this session.`)
      return target
    },
  }
}

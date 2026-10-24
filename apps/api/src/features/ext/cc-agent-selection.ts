/** Claude Code's default-agent sentinel is external syntax, not a native AgentId. */
export const GENERAL_PURPOSE_AGENT = 'general-purpose'

export function roleNameOfSubagentType(subagentType: string | undefined): string | undefined {
  const name = subagentType?.trim()
  // `general-purpose` and the catch-all `claude` are the invoking agent itself.
  const self = name?.toLowerCase()
  return !name || self === GENERAL_PURPOSE_AGENT || self === 'claude' ? undefined : name
}

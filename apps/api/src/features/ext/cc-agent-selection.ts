/** Claude Code's default-agent sentinel is external syntax, not a native AgentId. */
export const GENERAL_PURPOSE_AGENT = 'general-purpose'

export function roleNameOfSubagentType(subagentType: string | undefined): string | undefined {
  const name = subagentType?.trim()
  return !name || name.toLowerCase() === GENERAL_PURPOSE_AGENT ? undefined : name
}

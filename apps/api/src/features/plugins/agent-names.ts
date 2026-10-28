/**
 * HOW CLAUDE CODE NAMES AN AGENT (sub-agents.md, `name`): the name is at most 256 characters,
 * never contains `:` (reserved for a plugin's `plugin:agent`) and does not start with `-`. No
 * character class is documented, so `Code Reviewer` and `reviewer.v2` are valid, and Localix keeps
 * the name as written.
 */

export const CC_AGENT_NAME_MAX = 256
/** Claude Code preloads "up to the first 32 distinct names" of an agent's `skills`. */
export const AGENT_PRELOAD_SKILLS_MAX = 32

/** Whether Claude Code would load an agent declaring this name. */
export function isValidCcAgentName(name: string, options: { namespaced?: boolean } = {}): boolean {
  return (
    name.length > 0 &&
    name.length <= CC_AGENT_NAME_MAX &&
    !name.startsWith('-') &&
    (options.namespaced === true || !name.includes(':'))
  )
}

/** The first {@link AGENT_PRELOAD_SKILLS_MAX} distinct names of an agent's `skills`, in order. */
export function preloadedSkills(names: readonly string[] | undefined): string[] {
  return [...new Set(names ?? [])].slice(0, AGENT_PRELOAD_SKILLS_MAX)
}

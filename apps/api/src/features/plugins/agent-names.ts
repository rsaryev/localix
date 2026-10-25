import { createHash } from 'node:crypto'

/**
 * HOW CLAUDE CODE NAMES AN AGENT, and how Localix addresses it (sub-agents.md, `name`): the name is
 * at most 256 characters, never contains `:` (reserved for a plugin's `plugin:agent`) and does not
 * start with `-`. No character class is documented, so `Code Reviewer` and `reviewer.v2` are
 * valid there. Localix also addresses an agent by a handle — typed after `@`, used in a file name
 * and in a record's identity — which allows letters, digits, `-` and `_` only; a valid Claude Code
 * name is mapped to the handle that reads closest to it.
 */

export const CC_AGENT_NAME_MAX = 256
/** The longest handle a record keeps (`agentAuthoredBlueprintSchema`). */
const HANDLE_MAX = 100
/** Claude Code preloads "up to the first 32 distinct names" of an agent's `skills`. */
export const AGENT_PRELOAD_SKILLS_MAX = 32

const SAFE_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/i

/** Whether Claude Code would load an agent declaring this name. */
export function isValidCcAgentName(name: string, options: { namespaced?: boolean } = {}): boolean {
  return (
    name.length > 0 &&
    name.length <= CC_AGENT_NAME_MAX &&
    !name.startsWith('-') &&
    (options.namespaced === true || !name.includes(':'))
  )
}

/**
 * The handle of one name segment: the name itself when it is already safe, else its letters and
 * digits lowercased and joined by `-` (accents folded). A name with nothing to keep, or one cut
 * short, gets a digest of the original so two different names never share a handle by accident.
 */
export function agentHandleSegment(name: string): string {
  const trimmed = name.trim()
  if (SAFE_SEGMENT_RE.test(trimmed) && trimmed.length <= HANDLE_MAX) return trimmed
  const slug = trimmed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
  const kept = slug.length > 80 ? slug.slice(0, 80) : slug
  const base = kept.replace(/[-_]+$/, '')
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8)
  return base && base === slug ? base : base ? `${base}-${digest}` : `agent-${digest}`
}

/** The first {@link AGENT_PRELOAD_SKILLS_MAX} distinct names of an agent's `skills`, in order. */
export function preloadedSkills(names: readonly string[] | undefined): string[] {
  return [...new Set(names ?? [])].slice(0, AGENT_PRELOAD_SKILLS_MAX)
}

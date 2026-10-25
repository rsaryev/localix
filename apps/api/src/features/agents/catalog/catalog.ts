import type { CatalogAgent } from './agent-file'

/** What `resolve` answers: the agent, several it could be, or nothing. */
export type ResolvedAgent = { agent: CatalogAgent } | { ambiguous: string[] } | null

export interface AgentCatalog {
  /** Every definition found, shadowed ones included, in precedence order. */
  all: readonly CatalogAgent[]
  /** The definition of each name that Claude Code would run. */
  active: readonly CatalogAgent[]
  /** The definition that hides this one, when it is shadowed. */
  shadowedBy(agent: CatalogAgent): CatalogAgent | undefined
  /**
   * THE one lookup of an agent by what a person or model typed: its name (`reviewer`,
   * `@reviewer`, `@agent-reviewer`, a plugin's `acme:reviewer`), case-insensitive only when that
   * is unambiguous, and a plugin's bare name only when one plugin alone has it. Chat, delegation,
   * loops, mentions and `/skill` call this; none of them matches names itself.
   */
  resolve(reference: string): ResolvedAgent
}

const lower = (text: string) => text.toLowerCase()

/**
 * The catalog of one scope from its definitions in Claude Code's precedence, highest first:
 * managed, project (the closest folder first), user, plugin, built in. The first definition of a
 * name wins; the rest stay listed as shadowed.
 */
export function composeCatalog(ordered: readonly CatalogAgent[]): AgentCatalog {
  const winners = new Map<string, CatalogAgent>()
  for (const agent of ordered) if (!winners.has(agent.fullName)) winners.set(agent.fullName, agent)
  const active = [...winners.values()]

  const named = (wanted: string): ResolvedAgent => {
    const exact = active.find(
      (agent) => agent.fullName === wanted || agent.aliases?.includes(wanted),
    )
    if (exact) return { agent: exact }
    const folded = active.filter(
      (agent) =>
        lower(agent.fullName) === lower(wanted) ||
        agent.aliases?.some((alias) => lower(alias) === lower(wanted)),
    )
    if (folded.length === 1) return { agent: folded[0]! }
    if (folded.length > 1) return { ambiguous: folded.map((agent) => agent.fullName) }
    const bare = active.filter(
      (agent) => agent.source === 'plugin' && lower(agent.name) === lower(wanted),
    )
    if (bare.length === 1) return { agent: bare[0]! }
    return bare.length > 1 ? { ambiguous: bare.map((agent) => agent.fullName) } : null
  }

  return {
    all: ordered,
    active,
    shadowedBy: (agent) => {
      const winner = winners.get(agent.fullName)
      return winner && winner !== agent ? winner : undefined
    },
    resolve(reference) {
      const wanted = reference.trim().replace(/^@/, '').trim()
      if (!wanted) return null
      return named(wanted) ?? (wanted.startsWith('agent-') ? named(wanted.slice(6)) : null)
    },
  }
}

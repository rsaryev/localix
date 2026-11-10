import type { ScopeAgent, ScopeAgents } from '../../plugins/kit'
import { bodyHashOf, type CatalogAgent, type ResolvedAgent } from './agent-file'
import { LOCALIX_AGENT, localixBuiltin } from './builtin-types'

/** The agents a plugin brings, with whether the plugin is on: an installed plugin is never gone. */
export interface PluginAgentGroup {
  plugin: string
  /** '' for a plugin installed for the person; else the project it is installed for. */
  projectId: string
  enabled: boolean
}

/** What one scope's agents are read from. */
export interface ScopeCatalog {
  /** The scope's subagents as the kit resolved them, the mods' (`$.agent.register`) with them. */
  agents: ScopeAgents
  /** Every installed plugin of the scope. */
  plugins: readonly PluginAgentGroup[]
  /** False while the project's folder cannot be read, which is no reason to forget its agents. */
  projectReadable: boolean
}

/** One scope's catalog with Localix's additions. */
export interface ComposedCatalog {
  /** Every file and plugin definition, shadowed ones included, highest priority first. */
  found: readonly CatalogAgent[]
  /** The built-in types, Localix's main agent with them. */
  builtins: readonly CatalogAgent[]
  /** The definition that took a shadowed one's name. */
  shadowedBy(agent: CatalogAgent): CatalogAgent | undefined
  /**
   * THE one lookup of an agent by what a person or model typed, as the kit reads a name (exact, a
   * plugin's agent bare when one plugin alone has it, `@agent-<name>`), and `localix`, which the
   * kit does not know, by its exact name.
   */
  readonly resolve: (reference: string) => ResolvedAgent
}

/**
 * The scope's catalog: the kit's definitions with the project they belong to, and Localix's
 * built-in prompts and main agent.
 */
export function composeCatalog(scope: ScopeCatalog, projectId: string): ComposedCatalog {
  const shaped = new Map<ScopeAgent, CatalogAgent>()
  const own = (agent: ScopeAgent): CatalogAgent => {
    const known = shaped.get(agent)
    if (known) return known
    const local = agent.source === 'project' || agent.plugin?.scope === 'project'
    const made = localixBuiltin({
      ...agent,
      projectId: local ? projectId : '',
      bodyHash: agent.source === 'builtin' ? '' : bodyHashOf(agent.prompt),
    })
    shaped.set(agent, made)
    return made
  }
  const active = scope.agents.agents.map(own)
  const lost = new Map(scope.agents.shadowed.map(({ agent, by }) => [own(agent), own(by)]))
  const mainShadow = active.find((agent) => agent.fullName === LOCALIX_AGENT.fullName)
  if (mainShadow) lost.set(LOCALIX_AGENT, mainShadow)
  const all = [...active, ...lost.keys()]

  return {
    found: all.filter((agent) => agent.source !== 'builtin'),
    builtins: [...all.filter((agent) => agent.source === 'builtin'), LOCALIX_AGENT],
    shadowedBy: (agent) => lost.get(agent),
    resolve: (reference) => {
      const found = scope.agents.resolve(reference)
      if (found) return 'agent' in found ? { agent: own(found.agent) } : found
      return reference.trim() === LOCALIX_AGENT.fullName ? { agent: LOCALIX_AGENT } : null
    },
  }
}

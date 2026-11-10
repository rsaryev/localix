import type { PluginIssue, PluginSession } from '@rsaryev/llx-plugin'
import {
  agentMentions,
  selectSessionAgent,
  type AgentCatalog,
  type CatalogAgent,
  type CatalogSource,
} from '@rsaryev/llx-plugin/agents'
import { buildLoadedAgent, type LoadedPluginAgent } from '../loader-contract'
import { agentOf } from './catalog/components'
import type { LocalixPluginHost } from './host'
import { openScopeSession, type PluginScope } from './scope-session'

/**
 * Where a subagent of a scope comes from (sub-agents.md, "Choose the subagent scope"): `managed`,
 * `project`, `user`, `plugin` or `builtin` (Localix passes no `--agents` flag, so never `flag`).
 */
export type ScopeAgentSource = CatalogSource

/** A subagent of a scope as the kit resolved it, in the shape Localix's runtime takes. */
export interface ScopeAgent extends LoadedPluginAgent {
  source: ScopeAgentSource
  /** The file; '' for a plugin's or a built-in agent. */
  path: string
  /** The plugin a plugin's agent belongs to: its id and whether it is the project's own install. */
  plugin?: { id: string; scope: 'user' | 'project' }
  /** Frontmatter `permissionMode`, as written. */
  permissionMode?: string
  /** Frontmatter `hooks`, active while the agent runs; never set for a plugin's or built-in agent. */
  hooks?: unknown
  /** Frontmatter `mcpServers`: names of configured servers and inline definitions. */
  mcpServers?: readonly unknown[]
}

/** What a name means in a scope: the agent, the plugins' agents the kit will not choose among, or none. */
export type AgentReference = { agent: ScopeAgent } | { ambiguous: string[] } | null

export interface ScopeAgents {
  /** The definition of each name, highest priority first. */
  readonly agents: readonly ScopeAgent[]
  /** The definitions that lost their name, with the one that took it. */
  readonly shadowed: readonly { readonly agent: ScopeAgent; readonly by: ScopeAgent }[]
  readonly issues: readonly PluginIssue[]
  /** The agents folders that exist now, to watch for changes. */
  readonly watch: readonly string[]
  /**
   * The one lookup of a subagent by what a person or the model typed: its name, a plugin's agent
   * by its bare name when one plugin alone has it, or an `@agent-<name>` mention.
   */
  readonly resolve: (reference: string) => AgentReference
}

const pluginNameOf = (agent: CatalogAgent) => agent.name.slice(0, agent.name.indexOf(':'))

/** One kit catalog entry as Localix's agent shape; `prompt` is the session's resolved one. */
function scopeAgentOf(
  agent: CatalogAgent,
  prompt: string,
  plugin: ScopeAgent['plugin'],
): ScopeAgent {
  const owner = agent.source === 'plugin' ? pluginNameOf(agent) : agent.source
  const fields = agentOf(
    {
      scopedName: agent.name,
      name: agent.ownName,
      definition: { ...agent.definition, prompt },
      extras: agent.extras,
      hooks: agent.hooks,
    },
    agent.source === 'plugin' ? owner : '',
  )
  const { permissionMode, mcpServers } = agent.definition
  return {
    ...buildLoadedAgent(owner, fields, (text) => text),
    fullName: agent.name,
    source: agent.source,
    path: agent.source === 'plugin' ? '' : (agent.path ?? ''),
    ...(plugin ? { plugin } : {}),
    // Claude Code starts a built-in such as Explore without the CLAUDE.md files.
    ...(agent.startsWith.claudeMd ? {} : { omitClaudeMd: true }),
    ...(permissionMode ? { permissionMode } : {}),
    ...(fields.hooks !== undefined ? { hooks: fields.hooks } : {}),
    ...(mcpServers?.length ? { mcpServers } : {}),
  }
}

/** The references the kit reads: an `@agent-` mention, else the name as `--agent` takes it. */
function lookup(catalog: AgentCatalog, of: (agent: CatalogAgent) => ScopeAgent) {
  return (reference: string): AgentReference => {
    const wanted = reference.trim()
    if (!wanted) return null
    const [mention] = agentMentions(wanted, catalog).mentions
    if (mention) return { agent: of(mention.agent) }
    const choice = selectSessionAgent(catalog, { flag: wanted })
    if (choice.ok) return choice.agent ? { agent: of(choice.agent) } : null
    // The kit refuses a bare name several plugins have; one no subagent has is simply none.
    const named = catalog.agents.filter((agent) => agent.ownName === wanted)
    return named.length ? { ambiguous: named.map((agent) => agent.name) } : null
  }
}

/** A scope's catalog read from its session: the folders read again, then resolved by the kit. */
export async function sessionAgents(
  session: PluginSession,
  plugins: PluginScope['plugins'],
  signal: AbortSignal = new AbortController().signal,
): Promise<ScopeAgents> {
  const reload = await session.reloadAgents({ signal })
  const catalog = session.agentCatalog()
  const resolved = await session.agents({ signal })
  const prompts = new Map(resolved.resolved.map((one) => [one.name, one.definition.prompt]))
  const running = new Map(
    session.plugins.filter((one) => one.enabled).map((one) => [one.name, one.id]),
  )
  const scopes = new Map(plugins.map((one) => [one.id, one.scope]))
  const made = new Map<CatalogAgent, ScopeAgent>()
  const of = (agent: CatalogAgent): ScopeAgent => {
    const known = made.get(agent)
    if (known) return known
    const id = agent.source === 'plugin' ? running.get(pluginNameOf(agent)) : undefined
    const plugin = id ? { id, scope: scopes.get(id) ?? 'user' } : undefined
    const prompt =
      (catalog.agents.includes(agent) && prompts.get(agent.name)) || agent.definition.prompt
    const shaped = scopeAgentOf(agent, prompt, plugin)
    made.set(agent, shaped)
    return shaped
  }
  return {
    agents: catalog.agents.map(of),
    shadowed: catalog.shadowed.map(({ agent, by }) => ({ agent: of(agent), by: of(by) })),
    issues: [...reload.issues, ...resolved.issues],
    watch: reload.watch,
    resolve: lookup(catalog, of),
  }
}

/**
 * The subagents of a scope as the kit resolves them (`session.reloadAgents`, `agentCatalog`) in a
 * session of the scope (`./scope-session`): the built-ins, the managed, project (the working
 * directory up to the repository root) and personal `.claude/agents` folders and the selected
 * plugins' agents, one definition per name by Claude Code's priority.
 */
export async function scopeAgents(
  host: LocalixPluginHost,
  scope: PluginScope,
  signal?: AbortSignal,
): Promise<ScopeAgents> {
  return sessionAgents(await openScopeSession(host, scope, 'agents'), scope.plugins, signal)
}

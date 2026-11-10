import type { PluginIssue, PluginSession } from '@rsaryev/llx-plugin'
import {
  agentMentions,
  catalogTier,
  selectSessionAgent,
  type AgentCatalog,
  type CatalogAgent,
  type CatalogTier,
} from '@rsaryev/llx-plugin/agents'
import { buildLoadedAgent, type LoadedPluginAgent } from '../loader-contract'
import { agentOf } from './catalog/components'
import type { LocalixPluginHost } from './host'
import { openScopeSession, type PluginScope } from './scope-session'
import { askedPermissionMode } from './spawn'
import type { AgentPermissionMode } from '../../../contracts/agent-permission-mode'

/**
 * Where a subagent of a scope comes from, as the row of the priority table it ranks by (sub-agents.md,
 * "Choose the subagent scope"): `managed`, `flag` (an agent a mod registered), `project`, `user`,
 * `plugin` or `builtin`.
 */
export type ScopeAgentSource = CatalogTier

/**
 * The agents a host registers at run time, as the `--agents` flag and the SDK `agents` option take
 * them: each key a subagent type, each value its definition (`prompt` and the frontmatter fields).
 */
export type HostAgents = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** A subagent of a scope as the kit resolved it, in the shape Localix's runtime takes. */
export interface ScopeAgent extends LoadedPluginAgent {
  source: ScopeAgentSource
  /** The file; '' for a plugin's or a built-in agent. */
  path: string
  /** The plugin a plugin's agent belongs to: its id and whether it is the project's own install. */
  plugin?: { id: string; scope: 'user' | 'project' }
  /** The Localix mode its frontmatter `permissionMode` asks for (`spawn.ts`). */
  permissionMode?: AgentPermissionMode
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
  /**
   * The agent the main conversation runs as (`session.selectAgent`): the `agent` of the scope's
   * settings, else the default `agent` of the enabled plugin loaded last; null for none, or for a
   * name no agent of the scope has.
   */
  readonly main: ScopeAgent | null
}

/** A plugin's agent's plugin, as the session runs it: its id, manifest name and install scope. */
interface AgentPlugin {
  readonly id: string
  readonly name: string
  readonly scope: 'user' | 'project'
}

/** One kit catalog entry as Localix's agent shape; `prompt` is the session's resolved one. */
function scopeAgentOf(agent: CatalogAgent, prompt: string, plugin?: AgentPlugin): ScopeAgent {
  const source = catalogTier(agent.source)
  const owner = plugin?.name ?? source
  const fields = agentOf(
    {
      scopedName: agent.name,
      name: agent.ownName,
      definition: { ...agent.definition, prompt },
      extras: agent.extras,
      hooks: agent.hooks,
    },
    plugin ? owner : '',
  )
  const { mcpServers } = agent.definition
  const permissionMode = askedPermissionMode(agent.definition.permissionMode)
  return {
    ...buildLoadedAgent(owner, fields, (text) => text),
    fullName: agent.name,
    source,
    path: source === 'plugin' || source === 'flag' ? '' : (agent.path ?? ''),
    ...(plugin ? { plugin: { id: plugin.id, scope: plugin.scope } } : {}),
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
    return choice.candidates.length
      ? { ambiguous: choice.candidates.map((agent) => agent.name) }
      : null
  }
}

/** The session's choice as a scope agent; a refused choice (an unknown name) is none. */
function mainAgentOf(
  choice: ReturnType<PluginSession['selectAgent']>,
  of: (agent: CatalogAgent) => ScopeAgent,
): ScopeAgent | null {
  return choice.ok && choice.agent ? of(choice.agent) : null
}

/** A scope's catalog read from its session: the folders read again, then resolved by the kit. */
export async function sessionAgents(
  session: PluginSession,
  plugins: PluginScope['plugins'],
  options: AgentsRead = {},
): Promise<ScopeAgents> {
  const signal = options.signal ?? new AbortController().signal
  const overrides = { flag: options.flag }
  const reload = await session.reloadAgents({ signal, overrides })
  const catalog = session.agentCatalog(overrides)
  const resolved = await session.agents({ signal, overrides })
  const prompts = new Map(resolved.resolved.map((one) => [one.name, one.definition.prompt]))
  const names = new Map(session.plugins.map((one) => [one.id, one.name]))
  const scopes = new Map(plugins.map((one) => [one.id, one.scope]))
  const pluginOf = (agent: CatalogAgent): AgentPlugin | undefined => {
    if (agent.source.kind !== 'plugin') return undefined
    const { pluginId: id } = agent.source
    return { id, name: names.get(id) ?? id, scope: scopes.get(id) ?? 'user' }
  }
  const made = new Map<CatalogAgent, ScopeAgent>()
  const of = (agent: CatalogAgent): ScopeAgent => {
    const known = made.get(agent)
    if (known) return known
    const plugin = pluginOf(agent)
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
    main: mainAgentOf(session.selectAgent({}, overrides), of),
  }
}

/** What a read of a scope's agents takes besides the scope. */
export interface AgentsRead {
  readonly signal?: AbortSignal | undefined
  /** The agents registered at run time (the mods'), the kit's `--agents` source; none by default. */
  readonly flag?: HostAgents | undefined
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
  options?: AgentsRead,
): Promise<ScopeAgents> {
  return sessionAgents(await openScopeSession(host, scope, 'agents'), scope.plugins, options)
}

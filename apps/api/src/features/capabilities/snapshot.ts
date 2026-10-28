import type { AgentSummary } from '../agents/contracts'
import {
  resolveEffectiveAgentConfig,
  type EffectiveConfigDefaults,
} from '../effective-config/effective-config'
import type { McpServer } from '../mcp/contracts'
import { toolCatalogEntries } from '../tools/catalog'
import { buildCapabilityToolSurface } from './snapshot-tool-surface'
import type { SkillCatalogEntry } from '../chat/contracts/skills'
import type { MiniAppContributions } from '../mini-apps/contracts'
import type { PluginContributions } from '../plugins/service-types'
import { composeCapabilities, type CapabilityKind, type ResolvedCapabilities } from './resolve'
import { ruleGrammar } from './rule-grammar'
import { composerTips, type BuiltinCommand } from './tips'
import { capabilityRevision } from './revision'
import type { CapabilitySnapshot, McpPromptSpec } from '../../contracts/capability-snapshot'

export { buildCapabilityToolSurface }

/**
 * THE capability resolver. One place computes the snapshot every client and (soon)
 * the runtime cache reads, so "is this plugin enabled" has exactly one answer per
 * revision instead of one per endpoint.
 *
 * The expensive fusion (filesystem discovery + DB enable state + the enable rule)
 * is NOT re-implemented here — `listPluginContributions` and `listMiniAppContributions` each
 * build their owner's catalog once and this module projects the results.
 */

export interface CapabilitySnapshotPorts {
  /** The product's own slash commands (`SLASH_COMMANDS`), taught as tips. */
  builtinCommands: readonly BuiltinCommand[]
  listPluginContributions(userId: string, projectId: string): Promise<PluginContributions>
  listMiniAppContributions(userId: string, projectId: string): Promise<MiniAppContributions>
  listAgents(userId: string, projectId: string): Promise<AgentSummary[]>
  listMcpServers(userId: string, projectId: string): Promise<McpServer[]>
  /**
   * The scope's skills as catalog summaries. A port rather than a direct call because
   * skills are owned by the chat service, and this module composes projections.
   */
  listSkills(userId: string, projectId: string): Promise<SkillCatalogEntry[]>
  loadUserAgentSettings(userId: string): Promise<unknown>
  loadProjectSettings(userId: string, projectId: string): Promise<unknown>
  /**
   * What the scope may use. A port rather than a direct repository call because this module
   * composes projections and owns no storage — the same reason skills arrive as one.
   */
  loadCapabilities(
    userId: string,
    projectId: string,
    agentId: string | null,
  ): Promise<ResolvedCapabilities>
  /**
   * The MCP tool names this scope's live connections would contribute, read from the client
   * manager's cache. Absent ⇒ the surface reports no MCP tools and no unprobed servers, which is
   * the honest answer for a caller that has not wired the port (tests, a reduced runtime).
   *
   * A PORT rather than a direct call because resolving which cwd a scope's servers were keyed
   * under belongs to the composition root — this module knows about tool surfaces, not git.
   */
  cachedMcpTools?(
    userId: string,
    projectId: string,
    /** The scope's role, so per-tool `mcp:<server>/<tool>` rules narrow the same way a run does. */
    agentId?: string | null,
  ): Promise<{
    servers: Array<{ serverId: string; serverName: string; tools: string[] }>
    unprobed: string[]
  }>
  /**
   * The prompts of this scope's connected MCP servers, from the client manager's cache: it never
   * connects, so a menu asking for it cannot start a stdio child. Absent ⇒ no prompts.
   */
  cachedMcpPrompts?(
    userId: string,
    projectId: string,
    agentId?: string | null,
  ): Promise<McpPromptSpec[]>
  defaults?: EffectiveConfigDefaults
}

export interface CapabilitySnapshotInput {
  userId: string
  /** '' = the no-project (global) scope. */
  projectId?: string
  /**
   * Look at the snapshot AS this agent: the rosters are unchanged, but every verdict is
   * composed with the agent's own scope, so a tool the agent has switched off reads as
   * disabled here exactly as it will at run time.
   */
  agentId?: string
}

export interface CapabilitySnapshotService {
  getSnapshot(input: CapabilitySnapshotInput): Promise<CapabilitySnapshot>
}

export function createCapabilitySnapshotService(
  ports: CapabilitySnapshotPorts,
): CapabilitySnapshotService {
  // The revision is the mutation-owned invalidation signal. Cache ONLY the complete
  // plugin fusion: effective settings, MCP state, and agent records have
  // independent lifecycles and must still be read for every snapshot.
  const contributionCache = new Map<string, Promise<[PluginContributions, MiniAppContributions]>>()
  let cachedRevision: number | null = null

  return {
    async getSnapshot(input) {
      const projectId = input.projectId ?? ''
      const agentId = input.agentId || null
      // Read the revision BEFORE the awaits below. A mutation landing mid-compose
      // would otherwise be stamped as already included, and the client would sit at
      // a revision that claims to cover a change this snapshot cannot contain. Too
      // low is self-correcting (the client refetches on the next poke); too high is
      // not.
      const revision = capabilityRevision()
      if (cachedRevision !== revision) {
        contributionCache.clear()
        cachedRevision = revision
      }
      const contributionKey = JSON.stringify([input.userId, projectId, revision])
      let contributionResult = contributionCache.get(contributionKey)
      if (!contributionResult) {
        contributionResult = Promise.all([
          ports.listPluginContributions(input.userId, projectId),
          ports.listMiniAppContributions(input.userId, projectId),
        ])
        contributionCache.set(contributionKey, contributionResult)
        // A rejected build is not a contribution result. Remove only this exact
        // promise: a later retry may already have replaced it after another failure.
        void contributionResult.catch(() => {
          if (contributionCache.get(contributionKey) === contributionResult) {
            contributionCache.delete(contributionKey)
          }
        })
      }
      const [
        [pluginContributions, miniAppContributions],
        agents,
        mcp,
        skills,
        userSettings,
        projectSettings,
        mcpTools,
        capabilities,
        mcpPrompts,
      ] = await Promise.all([
        contributionResult,
        ports.listAgents(input.userId, projectId).catch(() => []),
        ports.listMcpServers(input.userId, projectId).catch(() => []),
        // Fail-soft like the other catalogs: one unreadable skills directory must
        // degrade its own list, never the whole snapshot every surface reads.
        ports.listSkills(input.userId, projectId).catch(() => []),
        ports.loadUserAgentSettings(input.userId).catch(() => null),
        projectId ? ports.loadProjectSettings(input.userId, projectId).catch(() => null) : null,
        // Cache-only, so it cannot slow this request or start a stdio child. A failure here
        // must degrade the COUNT, never the snapshot: every other field is still correct.
        ports.cachedMcpTools?.(input.userId, projectId, agentId).catch(() => undefined),
        ports
          .loadCapabilities(input.userId, projectId, agentId)
          .catch(() => composeCapabilities([])),
        // Cache-only too; a failure leaves the composer without these commands, nothing else.
        ports.cachedMcpPrompts?.(input.userId, projectId, agentId).catch(() => []),
      ])
      // Every other setting still comes from the effective-config resolver; what a scope may
      // USE comes from its verdicts, which is the one store the run pipeline also reads.
      resolveEffectiveAgentConfig({
        userSettings,
        projectSettings,
        defaults: ports.defaults,
        projectScoped: Boolean(projectId),
      })
      const denied = new Set(
        capabilities.denied(
          'skill',
          skills.map((s) => s.name),
        ),
      )
      /**
       * Re-state a registry list's verdicts for THIS scope.
       *
       * The owning services answer for (user, project) — they have no agent to ask about.
       * When the snapshot is taken AS an agent, its own rules are the innermost link of
       * the chain, and a list that ignored them would show the screen one thing while the
       * run did another. Absent a rule the service's own answer stands, trust gate and all.
       */
      // A matching RULE overrides the row; anything else leaves the row's own answer, which
      // already carries the item's trust class from the catalog that built it. Asking
      // `effectFor` here would discard that — it would answer `allow` for an untouched
      // dropped-in plugin the catalog had correctly left waiting.
      const asScoped = <T extends { name: string; enabled: boolean }>(
        kind: CapabilityKind,
        rows: readonly T[],
      ): T[] =>
        rows.map((row) => {
          const verdict = capabilities.verdict(kind, row.name)
          return verdict.rule ? { ...row, enabled: verdict.effect === 'allow' } : row
        })
      const snapshot = {
        revision,
        scope: { projectId, agentId },
        plugins: asScoped('plugin', pluginContributions.plugins),
        miniApps: asScoped('mini-app', miniAppContributions.miniApps),
        tools: buildCapabilityToolSurface({
          miniApps: miniAppContributions.miniApps,
          disabledTools: capabilities.denied(
            'tool',
            toolCatalogEntries(miniAppContributions.miniApps).map((entry) => entry.meta.name),
          ),
          mcp: {
            servers: mcpTools?.servers ?? [],
            // Two independent reasons a server's tools go uncounted. The second is easy to miss:
            // a plugin may BUNDLE an MCP server, and those are contributed by
            // `loadEnabledPlugins` during run assembly — reaching them from a settings request
            // would mean running that load here. The names are already on the plugin record, so
            // naming them costs nothing and turns a silent under-count into a stated one.
            // No bundled mini app declares any today (checked: 0 of 19), which is precisely why
            // this would otherwise go unnoticed until someone installs one that does.
            unprobed: [
              ...new Set([
                ...(mcpTools?.unprobed ?? []),
                ...pluginContributions.plugins.flatMap((plugin) =>
                  plugin.enabled ? plugin.provides.mcpServers : [],
                ),
              ]),
            ],
          },
        }),
        views: miniAppContributions.views,
        themes: pluginContributions.themes,
        // An agent record's row is keyed by its own name, one level in.
        // An agent record's row is keyed by its own id, one level in.
        agents: agents.map((agent) => {
          const verdict = capabilities.verdict('agent', agent.record.id)
          return verdict.rule ? { ...agent, enabled: verdict.effect === 'allow' } : agent
        }),
        commands: pluginContributions.commands,
        miniAppCommands: miniAppContributions.commands,
        mcp: asScoped('mcp', mcp),
        mcpPrompts: mcpPrompts ?? [],
        // A skill's availability is a SCOPE fact, resolved from the same effective
        // settings the run pipeline reads — so a switch in the UI and the skill the
        // next run loads cannot disagree.
        skills: skills.map((skill) => ({
          ...skill,
          enabled: !denied.has(skill.name),
        })),
        // The rule grammar, sent so the editor explains and suggests what the ENGINE
        // understands rather than what a React file happens to say about it.
        grammar: ruleGrammar(),
      }
      // Tips are a PROJECTION of the document above, not a seventh catalog: they are
      // composed from the fields already resolved here, so a tip can never describe a
      // plugin, tool or skill differently from the snapshot it travelled with.
      return { ...snapshot, tips: composerTips(snapshot, ports.builtinCommands) }
    },
  }
}

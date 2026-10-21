import type { AgentSummary } from '../agents/contracts'
import { computeToolSurface } from '../effective-config/validate'
import {
  resolveEffectiveAgentConfig,
  type EffectiveConfigDefaults,
} from '../effective-config/effective-config'
import type { ToolSurfaceDenial } from '../effective-config/contracts'
import type { McpServer } from '../mcp/contracts'
import type { SkillCatalogEntry } from '../chat/contracts/skills'
import type { PluginContributions } from '../plugins/service-types'
import { CATEGORY_LABELS, toolCatalogEntries, type ToolCatalogPluginSource } from '../tools/catalog'
import { composeCapabilities, type CapabilityKind, type ResolvedCapabilities } from './resolve'
import { ruleGrammar } from './rule-grammar'
import { composerTips, type BuiltinCommand } from './tips'
import { capabilityRevision } from './revision'
import type { CapabilitySnapshot, CapabilityToolSurface } from '../../contracts/capability-snapshot'

/**
 * THE capability resolver. One place computes the snapshot every client and (soon)
 * the runtime cache reads, so "is this plugin enabled" has exactly one answer per
 * revision instead of one per endpoint.
 *
 * The expensive fusion (filesystem discovery + DB enable state + the enable rule)
 * is NOT re-implemented here — `listPluginContributions` runs `buildPluginCatalog`
 * once and this module projects its result.
 */

export interface CapabilitySnapshotPorts {
  /** The product's own slash commands (`SLASH_COMMANDS`), taught as tips. */
  builtinCommands: readonly BuiltinCommand[]
  listPluginContributions(userId: string, projectId: string): Promise<PluginContributions>
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

/**
 * Project the tool catalog of one scope through the deny policy the run pipeline
 * consumes, keeping the tools it removed and WHY.
 *
 * Pure, and the reason this is not inlined below: it is the rule the "disabling a
 * plugin removes its tools" behaviour rests on, so it is unit-testable without a DB,
 * a filesystem, or a session.
 *
 * Deliberately NOT modelled here: descriptor-level `availability.requiredCapabilities`
 * (an unavailable preview host, a missing orchestration capability). Those are
 * per-RUN host facts that `computeToolSurface` has always refused to guess — see its
 * comment — and guessing them from a settings request would produce a second, weaker
 * copy of a rule the tool registry already owns.
 */
export function buildCapabilityToolSurface(input: {
  plugins: readonly ToolCatalogPluginSource[]
  disabledTools: string[]
  mcp?: {
    servers: Array<{ serverId: string; serverName: string; tools: string[] }>
    unprobed: string[]
  }
}): CapabilityToolSurface {
  const entries = toolCatalogEntries(input.plugins)
  const structuralDenials: ToolSurfaceDenial[] = entries.flatMap((entry) =>
    entry.unavailableReason
      ? [{ name: entry.meta.name, reason: entry.unavailableReason, source: 'capability' as const }]
      : [],
  )
  const surface = computeToolSurface({
    disabledTools: input.disabledTools,
    // The FULL catalog, not just the dispatchable subset: a name that never reaches
    // `computeToolSurface` can appear in neither `enabled` nor `disabled`, and a tool
    // that silently vanishes is the symptom this endpoint exists to end.
    toolNames: entries.map(({ meta }) => meta.name),
    structuralDenials,
  })
  return {
    ...surface,
    catalog: entries.map(({ meta }) => meta),
    categoryLabels: CATEGORY_LABELS,
    // MCP rides alongside rather than through `computeToolSurface`: that function resolves the
    // settings deny-policy over names the Tools tab can toggle, and an MCP tool is switched off
    // somewhere else entirely. Passing it through would render a row whose switch is not there.
    mcp: input.mcp?.servers ?? [],
    // ONE list, because the consumer's question is the same whatever the reason: "what is missing
    // from this number". The caller decides what goes in — this function stays descriptor-free.
    mcpUnprobedServers: input.mcp?.unprobed ?? [],
  }
}

export function createCapabilitySnapshotService(
  ports: CapabilitySnapshotPorts,
): CapabilitySnapshotService {
  // The revision is the mutation-owned invalidation signal. Cache ONLY the complete
  // plugin fusion: effective settings, MCP state, and agent records have
  // independent lifecycles and must still be read for every snapshot.
  const contributionCache = new Map<string, Promise<PluginContributions>>()
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
        contributionResult = ports.listPluginContributions(input.userId, projectId)
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
        contributions,
        agents,
        mcp,
        skills,
        userSettings,
        projectSettings,
        mcpTools,
        capabilities,
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
        plugins: asScoped('plugin', contributions.plugins),
        tools: buildCapabilityToolSurface({
          plugins: contributions.plugins,
          disabledTools: capabilities.denied(
            'tool',
            toolCatalogEntries(contributions.plugins).map((entry) => entry.meta.name),
          ),
          mcp: {
            servers: mcpTools?.servers ?? [],
            // Two independent reasons a server's tools go uncounted. The second is easy to miss:
            // a plugin may BUNDLE an MCP server, and those are contributed by
            // `loadEnabledPlugins` during run assembly — reaching them from a settings request
            // would mean running that load here. The names are already on the plugin record, so
            // naming them costs nothing and turns a silent under-count into a stated one.
            // No bundled plugin declares any today (checked: 0 of 19), which is precisely why
            // this would otherwise go unnoticed until someone installs one that does.
            unprobed: [
              ...new Set([
                ...(mcpTools?.unprobed ?? []),
                ...contributions.plugins.flatMap((plugin) =>
                  plugin.enabled ? plugin.provides.mcpServers : [],
                ),
              ]),
            ],
          },
        }),
        views: contributions.views,
        // An agent record's row is keyed by its own name, one level in.
        // An agent record's row is keyed by its own id, one level in.
        agents: agents.map((agent) => {
          const verdict = capabilities.verdict('agent', agent.record.id)
          return verdict.rule ? { ...agent, enabled: verdict.effect === 'allow' } : agent
        }),
        commands: contributions.commands,
        mcp: asScoped('mcp', mcp),
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

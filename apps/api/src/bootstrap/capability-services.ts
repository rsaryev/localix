import type { Kysely } from 'kysely'

import type { AppDatabase } from '../db'
import { mcpClientManager } from '../features/mcp/client-manager'
import { createCapabilitySnapshotService } from '../features/capabilities/snapshot'
import { createCapabilityApplyService, namesOf } from '../features/capabilities/apply'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { createCapabilityRuleRepository } from '../features/capabilities/rule-repository'
import { resolveCapabilities } from '../features/capabilities/resolve'
import { builtinAgentPresetFor } from '../features/capabilities/builtin-agent-presets'
import { createAvailabilityWriter, readAvailability } from '../features/capabilities/availability'
import type { Rule } from '../features/agent-core/capability-rule'
import type { CapabilityScope } from '../features/capabilities/contracts'
import type { CapabilityRoutesService } from '../features/capabilities/routes'
import { toSkillSummary } from '../features/chat/service/skills'
import type { createChatService } from '../features/chat/service'
import type { DomainServicesPhase } from './domain-services'

/**
 * The capability half of the app-services phase, composed on its own.
 *
 * It is one subject — what a scope may do — read three ways: a snapshot for the screens, a
 * toggle for the switches, a rule list for the editor. All three read the SAME repository
 * instance and the same resolver, which is the property that keeps the settings screen and
 * the run from answering differently; splitting them across files would put that guarantee
 * where nothing states it.
 */
export interface CapabilityServicesInput extends Pick<
  DomainServicesPhase,
  | 'projectsService'
  | 'userService'
  | 'resolveProjectCwd'
  | 'mcpService'
  | 'pluginService'
  | 'agentsService'
> {
  db: Kysely<AppDatabase>
  chatService: ReturnType<typeof createChatService>
}

export interface CapabilityServices {
  capabilityRules: ReturnType<typeof createCapabilityRuleRepository>
  capabilitySnapshotService: ReturnType<typeof createCapabilitySnapshotService>
  capabilityApplyService: ReturnType<typeof createCapabilityApplyService>
  /** One scope's own rules — read and replace, in the vocabulary the routes require. */
  capabilityPermissions: Pick<CapabilityRoutesService, 'readRules' | 'writeRules'>
}

export function createCapabilityServices({
  db,
  chatService,
  projectsService,
  userService,
  resolveProjectCwd,
  mcpService,
  pluginService,
  agentsService,
}: CapabilityServicesInput): CapabilityServices {
  // ONE versioned capability snapshot (`GET /rpc/capabilities/snapshot`). Read-only,
  // and the only projection of "what can this scope do" the clients consume: the
  // plugin list, its tools, its views/commands, managed agents, and MCP
  // servers all come from this single resolver, so they cannot disagree about which
  // plugins are enabled the way four independent endpoints could.
  // The scoped verdict store every capability question is answered from. One instance, so a
  // toggle and the run that follows it read the same rows.
  const capabilityRules = createCapabilityRuleRepository(db)
  const capabilitySnapshotService = createCapabilitySnapshotService({
    listPluginContributions: (userId, projectId) =>
      pluginService.listPluginContributions(userId, { projectId }),
    listAgents: (userId, projectId) => agentsService.listAgents(userId, { projectId }),
    listMcpServers: async (userId, projectId) =>
      (await mcpService.listServers(userId, { projectId })).servers,
    listSkills: async (userId, projectId) =>
      (await chatService.listSkills(userId, { projectId })).skills.map(toSkillSummary),
    // The agent's rules, resolved by the same call the run uses. Deciding availability a
    // second way here is exactly how the settings screen and the run came to disagree.
    loadCapabilities: (userId, _projectId, agentId) =>
      resolveCapabilities(capabilityRules, { userId, agentId: agentId || DEFAULT_AGENT_ID }),
    loadUserAgentSettings: async (...args) =>
      (await userService.getProfile(...args).catch(() => null))?.agentSettings ?? null,
    loadProjectSettings: async (...args) =>
      (await projectsService.getProject(...args).catch(() => null))?.settings ?? null,
    // Cache-only, so a Settings request can never start an stdio child. The cwd has to match the
    // one the run keyed its connections under, which is the project's working directory —
    // `resolveMcpTools` passes the same `defaultCwd`. A scope with no project, or a project whose
    // directory cannot be resolved, has no warm entry to find, so every server lands in
    // `unprobed` and the UI says "not yet connected" instead of inventing a zero.
    //
    // Plugin-BUNDLED MCP servers are absent here on purpose: they are contributed by
    // `loadEnabledPlugins` at run assembly, and reaching them would mean running that load from a
    // settings request. They show up in the count once the run publishes its real roster; until
    // then the estimate is a lower bound, which is the direction that stays honest.
    cachedMcpTools: async (...args) => {
      const [userId, projectId, agentId] = args
      const cwd = projectId ? await resolveProjectCwd(userId, projectId) : null
      const [servers, availability] = await Promise.all([
        mcpService.listForRuntime(userId, projectId),
        readAvailability(db, { userId, agentId: agentId || DEFAULT_AGENT_ID }),
      ])
      // The screen reports what the RUN would send, so it applies the same per-tool rules
      // the gather does. Reading them here rather than showing the server's full listing is
      // what keeps the tool count and the roster from disagreeing.
      return mcpClientManager.cachedToolNames(
        servers,
        cwd ?? '',
        (serverName, toolName) =>
          availability.effectFor('mcp', `${serverName}/${toolName}`) !== 'deny',
      )
    },
  })

  /**
   * ONE way to switch a capability on or off (`POST /rpc/capabilities/toggle`).
   *
   * Plugins, agents, agent providers, MCP servers, their tools, and the builtin/plugin
   * tool deny-list used to be five endpoints in four features, each answering with its
   * own record shape and each followed by a client refetch of the snapshot it had just
   * invalidated. They are the same operation, so they are now one — and its answer IS
   * the new snapshot, so a toggle costs one round trip instead of two.
   */
  // One scope's OWN rules, read and replaced. The composed answer a run evaluates is the
  // resolver's and is not editable as such: an editor over the composition could not say
  // which scope a change belonged to.
  const capabilityPermissions = {
    readRules: async (userId: string, target: CapabilityScope) => {
      // The agent IS the scope now, and an unnamed one is the agent that always exists —
      // the same answer the run would reach, so the editor and the turn cannot diverge.
      const scope = target.agentId || DEFAULT_AGENT_ID
      const review = target.agentId
        ? await agentsService.registrationPolicy.reviewIfRegistered(userId, target.agentId)
        : null
      if (review)
        return {
          scope,
          revision: review.policyRevision,
          rules: review.currentRules,
          registration: {
            agentId: review.agentId,
            projectId: review.projectId,
            sourceName: review.sourceName,
            revision: review.registrationRevision,
            proposedRules: review.proposedRules,
          },
        }
      // A system role's shipped rules travel with its own list, so the editor can say
      // whether the list still matches what we ship without a second round trip.
      const defaults = builtinAgentPresetFor(scope)
      return {
        scope,
        ...(await capabilityRules.readSnapshot(userId, scope)),
        ...(defaults ? { defaults } : {}),
      }
    },
    writeRules: async (
      userId: string,
      target: CapabilityScope,
      rules: Rule[],
      expectedRevision: number,
    ) => {
      const scope = target.agentId || DEFAULT_AGENT_ID
      const revision = await capabilityRules.publish(userId, scope, rules, expectedRevision)
      return { scope, revision }
    },
  }
  /**
   * Adapt each owning service's single-record method to the toggle port's batch shape.
   *
   * The two shapes differ for a reason and neither should bend to the other: a service
   * also answers its own route, which wants the record back, while the toggle endpoint
   * wants one call per kind and answers with the snapshot. Applied sequentially, so a
   * failure names the change that failed instead of leaving a partial parallel mess.
   */
  /**
   * What each kind needs BESIDES the rule being written. The rule is the whole state, so
   * these are consequences, not storage: a plugin's dependency cascade and host re-wire, an
   * agent the app cannot run without, an MCP change other screens must learn about.
   */
  const capabilityApplyService = createCapabilityApplyService({
    availability: createAvailabilityWriter(db),
    snapshots: capabilitySnapshotService,
    reactions: {
      plugin: {
        settles: true,
        expand: (userId, scope, changes) =>
          pluginService.planPolicyCascade(
            userId,
            scope,
            namesOf(changes, 'plugin', (effect) => effect === 'allow'),
          ),
        after: (userId, scope, changes) =>
          pluginService.onPolicyChanged(userId, scope, namesOf(changes, 'plugin')),
      },
      agent: {
        validate: (userId, scope, changes) =>
          agentsService.assertPolicyChange(
            userId,
            scope.projectId || null,
            namesOf(changes, 'agent', (effect) => effect === 'deny'),
          ),
      },
      mcp: { after: async () => mcpService.onPolicyChanged() },
    },
  })

  return {
    capabilityRules,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
  }
}

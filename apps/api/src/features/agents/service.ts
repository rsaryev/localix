import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { createContributionReader } from '../ext/contribution-reader'
import { agentContributionSchema } from './contribution'
import { buildAgentCatalog } from './catalog'
import { createAgentInvocationService } from './invocation-service'
import { createRegistrationPolicyService } from './registration-policy'
import { applySwitches, createAvailabilityWriter } from '../capabilities/availability'
import { createInvocationRegistry } from '../capabilities/invocation'
import { createNativeAgent } from './create-native-agent'
import { createAgentAuthoring } from './authoring'
import { globalAgentsDir, projectAgentsDir } from './discovery'
import { visibleInScope } from './registry-identity'
import { builtinAgentRecord } from './builtin'
import { agentPolicy, FIELD_LABELS, lockedChanges } from './policy'
import { assertDisablable } from './disable-guard'
import { removeAgentRecordFiles, writeAgentRecordFile } from './registry-files'
import type { AgentRecord, AgentSummary } from './contracts'
import type { AgentsService, AgentsServiceDeps } from './service-contract'
import { BUILTIN_OVERRIDE_FIELD, builtinOverrideHash } from './builtin-override'
import { createAgentAnnouncer } from './announce'

export type { AgentsService, AgentsServiceDeps } from './service-contract'

export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const repo: CapabilitySourceRepository = deps.capabilityStores.sources(deps.db, 'agent', deps.now)
  // The one writer of availability, shared with every other kind.
  const availabilityWriter = createAvailabilityWriter(deps.db)
  const { keys: announceAgent, write: announced } = createAgentAnnouncer(deps.db)
  const ruleRepository = deps.capabilityStores.rules(deps.db)
  const invocations = deps.invocations ?? createInvocationRegistry()
  const serialize = createKeyedSerializer()
  const contributions = createContributionReader(deps.db, 'agent', agentContributionSchema)

  const cwdFor = async (userId: string, projectId: string): Promise<string | null> => {
    if (projectId && deps.resolveProjectCwd) return deps.resolveProjectCwd(userId, projectId)
    return null
  }

  /** The one directory a scope's definitions are written to. */
  const dirFor = async (userId: string, projectId: string): Promise<string> => {
    if (!projectId) return deps.globalDir ?? globalAgentsDir()
    const cwd = await cwdFor(userId, projectId)
    if (!cwd)
      throw new NotFoundError('project_directory_missing', 'Project directory is unavailable')
    return projectAgentsDir(cwd)
  }

  const buildCatalog = async (userId: string, projectId: string) => {
    await deps.syncBundledContributions?.(userId, projectId)
    return buildAgentCatalog({
      db: deps.db,
      stores: deps.capabilityStores,
      invocations,
      userId,
      projectId,
      cwd: await cwdFor(userId, projectId),
      globalDir: deps.globalDir,
    })
  }

  /** Find an entry in one exact scope. */
  const pickInScope = (
    catalog: Awaited<ReturnType<typeof buildCatalog>>,
    name: string,
    projectId: string,
  ): AgentSummary | undefined => {
    // The person's record is managed here like a shipped agent's, though no agent list holds it.
    const scoped = [...catalog.all, catalog.human].filter((agent) => agent.projectId === projectId)
    const exact = scoped.find((agent) => agent.record.id === name)
    if (exact) return exact
    const matches = scoped.filter((agent) => agent.record.handle === name)
    if (matches.length > 1) throw new ConflictError('agent_ambiguous', 'Select an agent by ID')
    return matches[0]
  }

  /**
   * Find an entry as the scope sees it: its own definitions first, then the installation's
   * (`discoverAgents` lists those in every project). Writes go to the entry's own scope.
   */
  const pickEntry = (
    catalog: Awaited<ReturnType<typeof buildCatalog>>,
    name: string,
    projectId: string,
  ): AgentSummary | undefined =>
    pickInScope(catalog, name, projectId) ??
    (projectId ? pickInScope(catalog, name, '') : undefined)

  /** …and the catalog read that precedes it, which every per-name verb starts with. */
  const findEntry = async (userId: string, name: string, scope: string) =>
    pickEntry(await buildCatalog(userId, scope), name, scope)

  const creationPorts = {
    find: findEntry,
    // A project may shadow an installation agent's handle, so a collision is same-scope only.
    findInScope: async (userId: string, name: string, scope: string) =>
      pickInScope(await buildCatalog(userId, scope), name, scope),
    dir: dirFor,
    sources: repo,
    rules: ruleRepository,
    availability: availabilityWriter,
  }

  return {
    ...createAgentAuthoring(creationPorts, serialize),
    ...createAgentInvocationService(buildCatalog, invocations),
    registrationPolicy: createRegistrationPolicyService(deps.db, deps.capabilityStores),
    async listAgents(userId, opts) {
      const projectId = opts?.projectId ?? ''
      const catalog = await buildCatalog(userId, projectId)
      return catalog.all
    },

    async getHuman(userId, projectId) {
      return (await buildCatalog(userId, projectId ?? '')).human.record
    },

    async listRegistrationDiagnostics(userId, projectId) {
      return (await contributions.list(userId, projectId ?? '')).errors
    },

    async assertPolicyChange(userId, projectId, deniedIds) {
      if (deniedIds.length === 0) return
      assertDisablable((await buildCatalog(userId, projectId ?? '')).all, deniedIds)
    },

    // `_agentId` is the caller's idea of WHOSE rules to write, and it is no longer theirs to
    // choose: an `agent:<id>` rule belongs to that agent's own list, wherever the request
    // came from. Kept in the signature because the route still sends it.
    setAgentEnabled: (userId, name, enabled, projectId, _agentId) =>
      announced(async () => {
        const scope = projectId ?? ''
        const catalog = await buildCatalog(userId, scope)
        const entry = pickEntry(catalog, name, scope)
        if (!entry) throw new NotFoundError('agent_not_found', 'Agent not found')
        if (!enabled && !agentPolicy(entry).disable) {
          throw new InvalidRequestError(
            'agent_always_enabled',
            'This agent cannot be switched off — the app runs on it. Duplicate it to get one you own.',
          )
        }
        // An `agent:<id>` rule lives in that agent's OWN list — "may this role be invoked" is a
        // statement about the role, and keeping it beside the role's tool rules is what lets a
        // delete drop both in one write.
        // The rule write bumps the capability revision once; `announced` sees that bump.
        await ruleRepository.mutate(userId, entry.record.id, (current) =>
          applySwitches(current, 'agent', [{ name: entry.record.id, enabled }]),
        )
        const refreshed = await buildCatalog(userId, scope)
        return pickEntry(refreshed, name, entry.projectId)!
      }),

    async getAgent(userId, name, projectId) {
      return (await findEntry(userId, name, projectId ?? '')) ?? null
    },

    createAgent: (userId, input) =>
      announced(() =>
        serialize(JSON.stringify([userId, input.projectId ?? '']), () =>
          createNativeAgent(creationPorts, userId, input),
        ),
      ),

    updateAgent: (userId, name, input, projectId) =>
      announced(() =>
        serialize(JSON.stringify([userId, projectId ?? '']), async () => {
          const scope = projectId ?? ''
          const existing = pickEntry(await buildCatalog(userId, scope), name, scope)
          if (!existing) throw new NotFoundError('agent_not_found', 'Agent not found')
          if (existing.registration) {
            throw new InvalidRequestError(
              'agent_extension_owned',
              'Update this agent through its extension',
            )
          }
          const { projectId: _omit, enabled: _state, ...definition } = input
          const record: AgentRecord = { ...definition, id: existing.record.id }
          // One diff against the policy, rather than a guard per field: what a class may not
          // change is stated once, in `policy.ts`, and both this and the editor read it there.
          const locked = lockedChanges(
            agentPolicy(existing),
            existing.record,
            record as AgentRecord,
          )
          if (locked.length > 0) {
            throw new InvalidRequestError(
              'agent_field_locked',
              `This agent ships with the app: its ${locked
                .map((field) => FIELD_LABELS[field])
                .join(', ')} cannot be changed. Duplicate it to get one you own.`,
            )
          }
          const owner = existing.projectId
          const collision = await findEntry(userId, record.handle, owner)
          if (collision && collision.record.id !== record.id) {
            throw new ConflictError(
              'agent_exists',
              `An agent named "${record.handle}" already exists.`,
            )
          }
          const dir = await dirFor(userId, owner)
          await writeAgentRecordFile(dir, record)
          if (record.handle !== existing.record.handle)
            await removeAgentRecordFiles(dir, existing.record.handle)
          if (existing.builtin && owner) {
            await repo.patchConfig(userId, owner, record.id, {
              [BUILTIN_OVERRIDE_FIELD]: builtinOverrideHash(record),
            })
          }
          // A rename moves the agent's catalog key: the old one is gone, the new one exists.
          if (record.handle !== existing.record.handle)
            await announceAgent(owner, record.id, [existing.record.handle, record.handle])
          return pickEntry(await buildCatalog(userId, scope), record.id, scope)!
        }),
      ),

    deleteAgent: (userId, name, projectId) =>
      announced(() =>
        serialize(JSON.stringify([userId, projectId ?? '']), async () => {
          const scope = projectId ?? ''
          const existing = pickEntry(await buildCatalog(userId, scope), name, scope)
          if (!existing) throw new NotFoundError('agent_not_found', 'Agent not found')
          if (!agentPolicy(existing).delete) {
            throw new InvalidRequestError(
              'agent_builtin',
              'A system agent cannot be deleted. Restore its defaults or switch it off instead.',
            )
          }
          await removeAgentRecordFiles(
            await dirFor(userId, existing.projectId),
            existing.record.handle,
          )
          await repo.remove(userId, existing.projectId, existing.record.id)
          // The rule goes with it: a same-named file dropped in later must start inert rather
          // than inherit the deleted agent's answer.
          // The rules go with it. Nothing reads a deleted agent's list — ids are never reissued —
          // but the rows outlived every other trace of the agent, so a policy export or a
          // snapshot still listed a role no screen could reach. One statement covers both the
          // `agent:<id>` switch and the role's own tool rules, because they are the same list now.
          await ruleRepository.replace(userId, existing.record.id, [])
          await announceAgent(existing.projectId, existing.record.id, [existing.record.handle])
        }),
      ),

    resetAgent: (userId, name, projectId) =>
      announced(() => {
        const scope = projectId ?? ''
        return serialize(JSON.stringify([userId, scope]), async () => {
          const existing = pickEntry(await buildCatalog(userId, scope), name, scope)
          if (!existing) throw new NotFoundError('agent_not_found', 'Agent not found')
          if (!existing.builtin) {
            throw new InvalidRequestError(
              'agent_not_builtin',
              'Only a system agent has a default to reset to.',
            )
          }
          // Files only — the enable row is the user's on/off choice, not part of the definition.
          await removeAgentRecordFiles(
            await dirFor(userId, existing.projectId),
            existing.record.handle,
          )
          if (existing.projectId)
            await repo.patchConfig(userId, existing.projectId, existing.record.id, {
              [BUILTIN_OVERRIDE_FIELD]: null,
            })
          return pickEntry(await buildCatalog(userId, scope), name, scope)!
        })
      }),

    agentDefaults(name) {
      return builtinAgentRecord(name)
    },

    duplicateAgent: (userId, name, newName, projectId) =>
      announced(() => {
        const scope = projectId ?? ''
        return serialize(JSON.stringify([userId, scope]), async () => {
          const catalog = await buildCatalog(userId, scope)
          const source = pickEntry(catalog, name, scope)
          if (!source) throw new NotFoundError('agent_not_found', 'Agent not found')
          if (!agentPolicy(source).duplicate) {
            throw new InvalidRequestError('agent_not_duplicable', 'This agent cannot be copied.')
          }
          if (pickInScope(catalog, newName, scope)) {
            throw new ConflictError('agent_exists', `An agent named "${newName}" already exists.`)
          }
          // A copy is the user's own: the import provenance describes the SOURCE file, not this one.
          const { id: _origin, ...copied } = source.record
          return createNativeAgent(
            creationPorts,
            userId,
            {
              ...copied,
              handle: newName,
              projectId: scope || null,
              enabled: source.enabled,
            },
            { id: source.record.id, rules: await ruleRepository.read(userId, source.record.id) },
          )
        })
      }),

    async resolveEnabledAgent(userId, agentId, projectId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const chosen = catalog.enabled.find(
        (agent) => agent.record.id === agentId && visibleInScope(agent.projectId, scope),
      )
      return chosen?.record ?? null
    },

    async selectEnabledAgent(userId, handle, projectId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const named = (agent: AgentSummary) =>
        agent.record.handle === handle ||
        (agent.registration && `${agent.registration.sourceName}:${agent.record.handle}` === handle)
      // The project's own definition first; an installation agent only when the project has none.
      const own = catalog.enabled.filter((agent) => agent.projectId === scope && named(agent))
      const matches =
        own.length || !scope
          ? own
          : catalog.enabled.filter((agent) => !agent.projectId && named(agent))
      if (matches.length > 1) throw new ConflictError('agent_ambiguous', 'Select an agent by ID')
      return matches[0]?.record ?? null
    },
  }
}

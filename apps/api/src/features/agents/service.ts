import {
  createCapabilitySourceRepository,
  type CapabilitySourceRepository,
} from '../capabilities/source-repository'

import { ApiError } from '../../lib/errors'
import { createNativeAgentId } from './registry-identity'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { createContributionReader } from '../ext/contribution-reader'
import { agentContributionSchema } from './contribution'
import { buildAgentCatalog } from './catalog'
import { createAgentInvocationService } from './invocation-service'
import { createRegistrationPolicyService } from './registration-policy'
import { createAvailabilityWriter } from '../capabilities/availability'
import { createInvocationRegistry } from '../capabilities/invocation'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { inheritedAgentPreset } from '../capabilities/builtin-agent-presets'
import { globalAgentsDir, projectAgentsDir } from './discovery'
import { builtinAgentRecord } from './builtin'
import { agentPolicy, FIELD_LABELS, lockedChanges } from './policy'
import { assertDisablable } from './disable-guard'
import { removeAgentRecordFiles, writeAgentRecordFile } from './registry-files'
import type { AgentRecord, AgentSummary } from './contracts'
import type { AgentsService, AgentsServiceDeps } from './service-contract'

export type { AgentsService, AgentsServiceDeps } from './service-contract'

export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const repo: CapabilitySourceRepository = createCapabilitySourceRepository(
    deps.db,
    'agent',
    deps.now,
  )
  // The one writer of availability, shared with every other kind.
  const availabilityWriter = createAvailabilityWriter(deps.db)
  const ruleRepository = createCapabilityRuleRepository(deps.db)
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
      throw new ApiError(404, 'project_directory_missing', 'Project directory is unavailable')
    return projectAgentsDir(cwd)
  }

  const buildCatalog = async (userId: string, projectId: string) => {
    return buildAgentCatalog({
      db: deps.db,
      invocations,
      userId,
      projectId,
      cwd: await cwdFor(userId, projectId),
      globalDir: deps.globalDir,
    })
  }

  /** Find an entry only inside the requested exact scope. */
  const pickEntry = (
    catalog: Awaited<ReturnType<typeof buildCatalog>>,
    name: string,
    projectId: string,
  ): AgentSummary | undefined => {
    const scoped = catalog.all.filter((agent) => agent.projectId === projectId)
    const exact = scoped.find((agent) => agent.record.id === name)
    if (exact) return exact
    const matches = scoped.filter((agent) => agent.record.handle === name)
    if (matches.length > 1) throw new ApiError(409, 'agent_ambiguous', 'Select an agent by ID')
    return matches[0]
  }

  /** …and the catalog read that precedes it, which every per-name verb starts with. */
  const findEntry = async (userId: string, name: string, scope: string) =>
    pickEntry(await buildCatalog(userId, scope), name, scope)

  return {
    ...createAgentInvocationService(buildCatalog, invocations),
    registrationPolicy: createRegistrationPolicyService(deps.db),
    async listAgents(userId, opts) {
      const projectId = opts?.projectId ?? ''
      const catalog = await buildCatalog(userId, projectId)
      return catalog.all
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
    async setAgentEnabled(userId, name, enabled, projectId, _agentId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const entry = pickEntry(catalog, name, scope)
      if (!entry) throw new ApiError(404, 'agent_not_found', 'Agent not found')
      if (!enabled && !agentPolicy(entry).disable) {
        throw new ApiError(
          400,
          'agent_always_enabled',
          'This agent cannot be switched off — the app runs on it. Duplicate it to get one you own.',
        )
      }
      // An `agent:<id>` rule lives in that agent's OWN list — "may this role be invoked" is a
      // statement about the role, and keeping it beside the role's tool rules is what lets a
      // delete drop both in one write.
      await availabilityWriter.set(userId, entry.record.id, 'agent', [
        { name: entry.record.id, enabled },
      ])
      const refreshed = await buildCatalog(userId, scope)
      return pickEntry(refreshed, name, entry.projectId)!
    },

    async getAgent(userId, name, projectId) {
      return (await findEntry(userId, name, projectId ?? '')) ?? null
    },

    async createAgent(userId, input) {
      return serialize(JSON.stringify([userId, input.projectId ?? '']), async () => {
        const projectId = input.projectId ?? ''
        // Creating is not editing. Without this, "New agent" + an existing handle silently
        // overwrote that definition and flipped its enable row on — and the editor makes the
        // collision easy to reach, because create and edit are now the same panel. `update` is
        // how an existing record changes; a name already taken is refused here, as in `duplicate`.
        if (pickEntry(await buildCatalog(userId, projectId), input.handle, projectId)) {
          throw new ApiError(
            409,
            'agent_exists',
            `An agent named "${input.handle}" already exists.`,
          )
        }
        // `enabled` is enable-STATE (a DB row), not part of the record file — strip it.
        const { projectId: _omit, enabled, ...definition } = input
        const record: AgentRecord = { ...definition, id: createNativeAgentId(projectId) }
        // Lossless JSON write — engine tool names round-trip exactly (no CC mapping).
        await writeAgentRecordFile(await dirFor(userId, projectId), record as AgentRecord)
        // enabled ?? true: UI-authored agents turn on; an inert import passes false.
        await repo.upsert(userId, projectId, record.id, { source: 'local' })
        // The default agent's own rules, re-pointed at this one. It used to be a bare
        // `invocation:<host> allow` per host: no confirmations at all, so a brand-new agent
        // could touch a path outside the workspace or run `rm -rf` without asking while every
        // shipped role asked. See `inheritedAgentPreset`.
        await ruleRepository.replace(userId, record.id, inheritedAgentPreset(record.id))
        // A UI-authored agent turns on; an inert import passes `enabled: false` and stays
        // off. Either way the answer is STATED, because creating a record is the moment a
        // user decided about it — leaving it to the trust gate would read as "nobody has".
        await availabilityWriter.set(userId, record.id, 'agent', [
          { name: record.id, enabled: enabled ?? true },
        ])
        const catalog = await buildCatalog(userId, projectId)
        return pickEntry(catalog, record.handle, projectId)!
      })
    },

    async updateAgent(userId, name, input, projectId) {
      return serialize(JSON.stringify([userId, projectId ?? '']), async () => {
        const scope = projectId ?? ''
        const existing = pickEntry(await buildCatalog(userId, scope), name, scope)
        if (!existing) throw new ApiError(404, 'agent_not_found', 'Agent not found')
        if (existing.registration) {
          throw new ApiError(
            400,
            'agent_extension_owned',
            'Update this agent through its extension',
          )
        }
        if (input.handle !== existing.record.handle) {
          throw new ApiError(
            400,
            'agent_name_immutable',
            'An agent cannot be renamed; duplicate it.',
          )
        }
        const { projectId: _omit, enabled: _state, ...definition } = input
        const record: AgentRecord = { ...definition, id: existing.record.id }
        // One diff against the policy, rather than a guard per field: what a class may not
        // change is stated once, in `policy.ts`, and both this and the editor read it there.
        const locked = lockedChanges(agentPolicy(existing), existing.record, record as AgentRecord)
        if (locked.length > 0) {
          throw new ApiError(
            400,
            'agent_field_locked',
            `This agent ships with the app: its ${locked
              .map((field) => FIELD_LABELS[field])
              .join(', ')} cannot be changed. Duplicate it to get one you own.`,
          )
        }
        await writeAgentRecordFile(await dirFor(userId, scope), record as AgentRecord)
        return pickEntry(await buildCatalog(userId, scope), name, scope)!
      })
    },

    async deleteAgent(userId, name, projectId) {
      return serialize(JSON.stringify([userId, projectId ?? '']), async () => {
        const scope = projectId ?? ''
        const existing = pickEntry(await buildCatalog(userId, scope), name, scope)
        if (!existing) throw new ApiError(404, 'agent_not_found', 'Agent not found')
        if (!agentPolicy(existing).delete) {
          throw new ApiError(
            400,
            'agent_builtin',
            'A system agent cannot be deleted. Restore its defaults or switch it off instead.',
          )
        }
        await removeAgentRecordFiles(await dirFor(userId, scope), existing.record.handle)
        await repo.remove(userId, scope, existing.record.id)
        // The rule goes with it: a same-named file dropped in later must start inert rather
        // than inherit the deleted agent's answer.
        // The rules go with it. Nothing reads a deleted agent's list — ids are never reissued —
        // but the rows outlived every other trace of the agent, so a policy export or a
        // snapshot still listed a role no screen could reach. One statement covers both the
        // `agent:<id>` switch and the role's own tool rules, because they are the same list now.
        await ruleRepository.replace(userId, existing.record.id, [])
      })
    },

    async resetAgent(userId, name) {
      return serialize(JSON.stringify([userId, '']), async () => {
        const existing = pickEntry(await buildCatalog(userId, ''), name, '')
        if (!existing) throw new ApiError(404, 'agent_not_found', 'Agent not found')
        if (!existing.builtin) {
          throw new ApiError(
            400,
            'agent_not_builtin',
            'Only a system agent has a default to reset to.',
          )
        }
        // Files only — the enable row is the user's on/off choice, not part of the definition.
        await removeAgentRecordFiles(await dirFor(userId, ''), existing.record.handle)
        return pickEntry(await buildCatalog(userId, ''), name, '')!
      })
    },

    agentDefaults(name) {
      return builtinAgentRecord(name)
    },

    async duplicateAgent(userId, name, newName, projectId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const source = pickEntry(catalog, name, scope)
      if (!source) throw new ApiError(404, 'agent_not_found', 'Agent not found')
      if (!agentPolicy(source).duplicate) {
        throw new ApiError(400, 'agent_not_duplicable', 'This agent cannot be copied.')
      }
      if (pickEntry(catalog, newName, scope)) {
        throw new ApiError(409, 'agent_exists', `An agent named "${newName}" already exists.`)
      }
      // A copy is the user's own: the import provenance describes the SOURCE file, not this one.
      const { id: _origin, ...copied } = source.record
      return this.createAgent(userId, { ...copied, handle: newName, projectId: scope || null })
    },

    async resolveEnabledAgent(userId, agentId, projectId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const chosen = catalog.enabled.find(
        (agent) => agent.record.id === agentId && agent.projectId === scope,
      )
      return chosen?.record ?? null
    },

    async selectEnabledAgent(userId, handle, projectId) {
      const scope = projectId ?? ''
      const catalog = await buildCatalog(userId, scope)
      const matches = catalog.enabled.filter(
        (agent) => agent.record.handle === handle && agent.projectId === scope,
      )
      if (matches.length > 1) throw new ApiError(409, 'agent_ambiguous', 'Select an agent by ID')
      return matches[0]?.record ?? null
    },
  }
}

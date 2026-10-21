import { ConflictError, InternalError } from '../../lib/domain-errors'
import { createNativeAgentId } from './registry-identity'
import { writeAgentRecordFile } from './registry-files'
import { inheritedAgentPreset } from '../capabilities/builtin-agent-presets'
import type { Rule } from '../agent-core/capability-rule'
import type { AgentRecordInput, AgentSummary } from './contracts'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { VersionedCapabilityRuleRepository } from '../capabilities/rule-repository'
import type { AvailabilityWriter } from '../capabilities/availability'

export function copyAgentPolicy(rules: readonly Rule[], from: string, to: string): Rule[] {
  return rules.map((rule) => ({
    ...rule,
    action: rule.action === `agent:${from}` ? `agent:${to}` : rule.action,
    resource: rule.action.startsWith('invocation:') && rule.resource === from ? to : rule.resource,
  }))
}

/** Publish policy before the definition becomes discoverable; a copy never has an open-policy window. */
export async function createNativeAgent(
  ports: {
    find(userId: string, name: string, projectId: string): Promise<AgentSummary | undefined>
    findInScope(userId: string, name: string, projectId: string): Promise<AgentSummary | undefined>
    dir(userId: string, projectId: string): Promise<string>
    sources: Pick<CapabilitySourceRepository, 'upsert'>
    rules: Pick<VersionedCapabilityRuleRepository, 'replace'>
    availability: Pick<AvailabilityWriter, 'set'>
  },
  userId: string,
  input: AgentRecordInput,
  source?: { id: string; rules: readonly Rule[] },
  config?: Record<string, unknown>,
): Promise<AgentSummary> {
  const projectId = input.projectId ?? ''
  if (await ports.findInScope(userId, input.handle, projectId)) {
    throw new ConflictError('agent_exists', `An agent named "${input.handle}" already exists.`)
  }
  const dir = await ports.dir(userId, projectId)
  const { projectId: _omit, enabled, ...definition } = input
  const record = { ...definition, id: createNativeAgentId(projectId) }
  const policy = source
    ? copyAgentPolicy(source.rules, source.id, record.id)
    : inheritedAgentPreset(record.id)
  await ports.rules.replace(userId, record.id, policy)
  await ports.availability.set(userId, record.id, 'agent', [
    { name: record.id, enabled: enabled ?? true },
  ])
  await ports.sources.upsert(userId, projectId, record.id, { source: 'local', config })
  await writeAgentRecordFile(dir, record)
  const created = await ports.find(userId, record.id, projectId)
  if (!created) throw new InternalError('agent_publication_failed', 'Saved agent is unavailable')
  return created
}

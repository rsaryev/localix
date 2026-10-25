import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { agentHandleSchema } from '@localixai/agent/agents'
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
} from '../../lib/domain-errors'
import type { Rule } from '../agent-core/capability-rule'
import type { AvailabilityWriter } from '../capabilities/availability'
import { inheritedAgentPreset } from '../capabilities/builtin-agent-presets'
import type { VersionedCapabilityRuleRepository } from '../capabilities/rule-repository'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { newAgentId } from './bindings/bindings'
import type { AgentFolders } from './catalog/scan'
import type { AgentRecordInput, AgentSummary } from './contracts'
import { agentFilePath, agentFileText, writeAgentFile } from './file-writer'

export function copyAgentPolicy(rules: readonly Rule[], from: string, to: string): Rule[] {
  return rules.map((rule) => ({
    ...rule,
    action: rule.action === `agent:${from}` ? `agent:${to}` : rule.action,
    resource: rule.action.startsWith('invocation:') && rule.resource === from ? to : rule.resource,
  }))
}

export interface CreatePorts {
  folders(userId: string, projectId: string): Promise<AgentFolders>
  /** Reconciles, then lists the scope. */
  list(userId: string, projectId: string): Promise<AgentSummary[]>
  sources: Pick<CapabilitySourceRepository, 'upsert' | 'remove'>
  rules: Pick<VersionedCapabilityRuleRepository, 'replace'>
  availability: Pick<AvailabilityWriter, 'set'>
}

/** Where a new agent's file goes: the person's own folder, or the project's working directory. */
export async function agentsFolderFor(
  ports: Pick<CreatePorts, 'folders'>,
  userId: string,
  projectId: string,
): Promise<string> {
  const folders = await ports.folders(userId, projectId)
  const claudeDir = projectId ? folders.project?.[0] : folders.user
  if (!claudeDir)
    throw new NotFoundError('project_directory_missing', 'Project directory is unavailable')
  return join(claudeDir, 'agents')
}

/**
 * Write a new agent file with its policy already in place. Call it inside the bindings'
 * `exclusive`, so no reconcile interleaves. The binding row and the rules come
 * first, so the file never becomes discoverable without an answer to "what may it do" (no
 * open-policy window); the reconcile that follows adopts the row by its path.
 */
export async function createAgentFile(
  ports: CreatePorts,
  userId: string,
  input: AgentRecordInput,
  source?: { id: string; rules: readonly Rule[] },
  config?: Record<string, unknown>,
): Promise<AgentSummary> {
  const projectId = input.projectId ?? ''
  if (input.handle.includes(':'))
    throw new InvalidRequestError('agent_name_invalid', 'An agent file name has no ":"')
  const handle = agentHandleSchema.parse(input.handle)
  const dir = await agentsFolderFor(ports, userId, projectId)
  const path = agentFilePath(dir, handle)
  const taken = (await ports.list(userId, projectId)).some(
    (agent) => agent.editable && agent.projectId === projectId && agent.record.handle === handle,
  )
  if (taken || existsSync(path))
    throw new ConflictError('agent_exists', `An agent named "${handle}" already exists.`)
  const id = newAgentId()
  const policy = source ? copyAgentPolicy(source.rules, source.id, id) : inheritedAgentPreset(id)
  await ports.rules.replace(userId, id, policy)
  await ports.availability.set(userId, id, 'agent', [{ name: id, enabled: input.enabled ?? true }])
  await ports.sources.upsert(userId, projectId, id, {
    source: projectId ? 'project' : 'user',
    config: { name: handle, path, bodyHash: '', ...config },
  })
  try {
    await writeAgentFile(path, agentFileText('', { ...input, handle }))
  } catch (error) {
    await ports.sources.remove(userId, projectId, id)
    await ports.rules.replace(userId, id, [])
    throw error
  }
  const created = (await ports.list(userId, projectId)).find((agent) => agent.record.id === id)
  if (!created) throw new InternalError('agent_publication_failed', 'Saved agent is unavailable')
  return created
}

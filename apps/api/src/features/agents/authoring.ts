import { ConflictError, ForbiddenError, InvalidRequestError } from '../../lib/domain-errors'
import {
  agentAuthoredBatchSchema,
  agentAuthoredBlueprintSchema,
  type AgentAuthoredBlueprint,
} from '@localixai/agent/agents'
import { stableStringify } from '@localixai/agent'
import { createHash } from 'node:crypto'
import { ApiError, errorMessage } from '../../lib/errors'
import { createNativeAgent } from './create-native-agent'
import { agentRecordInputSchema } from './contracts'
import type {
  AgentsService,
  AgentCreationOrigin,
  AgentCreationBatchResult,
} from './service-contract'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { VersionedCapabilityRuleRepository } from '../capabilities/rule-repository'

const CREATION_FIELD = 'agentCreation'
const fingerprintOf = (input: unknown) =>
  createHash('sha256').update(stableStringify(input)).digest('hex')
type CreationMark = AgentCreationOrigin & {
  fingerprint: string
  batchOperationId?: string
  batchFingerprint?: string
}
type Source = NonNullable<Parameters<typeof createNativeAgent>[3]>

/** Single and batch writes use the same scope lock and immutable operation identities. */
export function createAgentAuthoring(
  ports: Parameters<typeof createNativeAgent>[0] & {
    sources: CapabilitySourceRepository
    rules: VersionedCapabilityRuleRepository
  },
  serialize: <T>(key: string, run: () => Promise<T>) => Promise<T>,
): Pick<AgentsService, 'createAgentFromAgent' | 'createAgentsFromAgent'> {
  const scopeOf = (origin: AgentCreationOrigin) => {
    if (!origin.agentId || !origin.sessionId || !origin.operationId) {
      throw new InvalidRequestError('agent_creation_origin', 'Agent creation requires a run origin')
    }
    return origin.projectId ?? ''
  }
  const sourceOf = async (userId: string, origin: AgentCreationOrigin): Promise<Source> => {
    const actor = await ports.find(userId, origin.agentId, origin.projectId ?? '')
    if (!actor?.enabled || actor.record.id !== origin.agentId) {
      throw new ForbiddenError(
        'agent_creator_unavailable',
        'The creating agent is unavailable in this registry',
      )
    }
    return { id: actor.record.id, rules: await ports.rules.read(userId, actor.record.id) }
  }
  const publish = async (
    userId: string,
    input: AgentAuthoredBlueprint,
    origin: AgentCreationOrigin,
    source: () => Promise<Source>,
    batch?: { batchOperationId: string; batchFingerprint: string },
  ) => {
    const scope = origin.projectId ?? ''
    const fingerprint = fingerprintOf(input)
    for (const row of await ports.sources.listForScope(userId, scope)) {
      if (row.projectId !== scope) continue
      const stored = row.config[CREATION_FIELD] as Partial<CreationMark> | undefined
      if (
        !stored ||
        stored.agentId !== origin.agentId ||
        stored.sessionId !== origin.sessionId ||
        stored.operationId !== origin.operationId
      )
        continue
      if (
        stored.fingerprint !== fingerprint ||
        stored.batchFingerprint !== batch?.batchFingerprint
      ) {
        throw new ConflictError(
          'agent_creation_conflict',
          'This operation already created a different agent',
        )
      }
      const saved = await ports.find(userId, row.name, scope)
      if (saved) return saved
      throw new ConflictError(
        'agent_creation_incomplete',
        'The earlier creation is unavailable; inspect the registry before retrying',
      )
    }
    return createNativeAgent(
      ports,
      userId,
      agentRecordInputSchema.parse({ ...input, projectId: scope }),
      await source(),
      {
        [CREATION_FIELD]: { ...origin, fingerprint, ...batch },
      },
    )
  }
  return {
    async createAgentFromAgent(userId, raw, origin) {
      const input = agentAuthoredBlueprintSchema.parse(raw)
      const scope = scopeOf(origin)
      return serialize(JSON.stringify([userId, scope]), () =>
        publish(userId, input, origin, () => sourceOf(userId, origin)),
      )
    },
    async createAgentsFromAgent(userId, raw, origin) {
      const inputs = agentAuthoredBatchSchema.parse(raw)
      const scope = scopeOf(origin)
      return serialize(JSON.stringify([userId, scope]), async () => {
        const batch = {
          batchOperationId: origin.operationId,
          batchFingerprint: fingerprintOf(inputs),
        }
        // Reject any changed batch before writes, including reordered, appended or removed entries.
        for (const row of await ports.sources.listForScope(userId, scope)) {
          const stored = row.config[CREATION_FIELD] as Partial<CreationMark> | undefined
          if (
            row.projectId === scope &&
            stored?.agentId === origin.agentId &&
            stored.sessionId === origin.sessionId &&
            stored.batchOperationId === batch.batchOperationId &&
            stored.batchFingerprint !== batch.batchFingerprint
          ) {
            throw new ConflictError(
              'agent_creation_conflict',
              'This operation already created a different team',
            )
          }
        }
        let source: Promise<Source> | undefined
        const sharedSource = () => (source ??= sourceOf(userId, origin))
        const result: AgentCreationBatchResult = { created: [], errors: [] }
        for (const [index, input] of inputs.entries()) {
          try {
            result.created.push(
              await publish(
                userId,
                input,
                { ...origin, operationId: `${origin.operationId}:${index}` },
                sharedSource,
                batch,
              ),
            )
          } catch (error) {
            result.errors.push({
              index,
              handle: input.handle,
              code: error instanceof ApiError ? error.code : 'agent_creation_failed',
              message: errorMessage(error),
            })
          }
        }
        return result
      })
    },
  }
}

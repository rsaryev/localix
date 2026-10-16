import type {
  AgentTool,
  AgentToolUpdateCallback,
  HumanInLoopRequestBase,
  HumanInLoopResponseBase,
} from '@localixai/agent/agents'
import {
  HITL_DECISION_MS,
  isHitlTimeout,
  unansweredError,
  unansweredRefusal,
} from '../agent-core/tools/hitl/decision-deadline'
import type { SecretMeta } from './contracts'
import type {
  RequestSecretRequest,
  RequestSecretResponse,
} from '../agent-core/tools/hitl/request-secret'
import type { VaultDeleteResult } from './store'
import type { VaultToolInput } from './vault-tool-schema'

interface ApprovalPayload {
  toolCallId: string
  loading_messages: string[]
  questions: Array<{
    id: string
    question: string
    options: Array<{ label: string; value: string; description: string }>
    recommended: number
  }>
}

type ApprovalRequest = HumanInLoopRequestBase<'ask', ApprovalPayload>
type ApprovalResponse = HumanInLoopResponseBase<
  'ask',
  {
    answers: Array<{
      id: string
      question: string
      selectedOptions: string[]
      customInput?: string
    }>
  }
>

/**
 * The vault's two cards used to wait ten minutes while every other card waited three, five,
 * or forever. One number now, and one shape of answer when it runs out.
 */
const HITL_TTL_MS = HITL_DECISION_MS

export async function requestSecretValue(
  toolCallId: string,
  input: Extract<VaultToolInput, { action: 'create' | 'rotate' }>,
  existingItem: SecretMeta | undefined,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  context: Parameters<AgentTool<VaultToolInput>['execute']>[4],
) {
  if (!context?.humanInLoop) {
    return {
      content: 'Cannot write a Vault value because no masked human input channel is available.',
      isError: true,
    }
  }

  const request: RequestSecretRequest = {
    id: toolCallId,
    kind: 'request_secret',
    payload:
      input.action === 'create'
        ? {
            action: 'create',
            key: input.key,
            reason: input.reason,
            type: input.type,
            label: input.title,
            description: input.description,
            tags: input.tags,
          }
        : {
            action: 'rotate',
            key: input.key,
            reason: input.reason,
            type: existingItem?.type ?? 'secret',
            label: existingItem?.label,
            description: existingItem?.description,
            tags: existingItem?.tags ?? [],
            expectedVersion: input.expected_version,
          },
    createdAt: Date.now(),
    expiresAt: Date.now() + HITL_TTL_MS,
  }

  onUpdate?.({ request, action: input.action, key: input.key } as never)
  try {
    const response = await context.humanInLoop.request<RequestSecretRequest, RequestSecretResponse>(
      request,
      signal,
    )
    const stored = response.payload.answers?.stored ?? false
    const outcome = response.payload.answers?.outcome
    return {
      content: stored
        ? `Vault item "${input.key}" ${outcome === 'rotated' ? 'rotated' : 'created'} securely. Use only its reference secret:${input.key}; the value remains hidden.`
        : `Vault item "${input.key}" was not changed (${outcome ?? 'cancelled'}).`,
      details: { action: input.action, key: input.key, stored, outcome },
    }
  } catch (error) {
    const content = isHitlTimeout(error)
      ? unansweredRefusal(`No value was stored for "${input.key}". Do not ask for it again.`)
      : `No Vault value was provided for "${input.key}".`
    return {
      content,
      isError: isHitlTimeout(error) || undefined,
      ...(isHitlTimeout(error) ? { error: unansweredError(content) } : {}),
      details: { action: input.action, key: input.key, stored: false },
    }
  }
}

export async function approveDeletion(
  toolCallId: string,
  input: Extract<VaultToolInput, { action: 'delete' }>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  context: Parameters<AgentTool<VaultToolInput>['execute']>[4],
  remove: (key: string, expectedVersion: number) => Promise<VaultDeleteResult>,
) {
  if (!context?.humanInLoop) {
    return {
      content: 'Cannot delete a Vault item because no human approval channel is available.',
      isError: true,
    }
  }
  const request: ApprovalRequest = {
    id: toolCallId,
    kind: 'ask',
    title: 'Review Vault deletion',
    payload: {
      toolCallId,
      loading_messages: ['Waiting for Vault approval'],
      questions: [
        {
          id: 'vault_delete',
          question: `Delete Vault item "${input.key}" at version ${input.expected_version}? ${input.reason}`,
          options: [
            {
              label: 'Keep item',
              value: 'deny',
              description: 'Leave the item and its references unchanged.',
            },
            {
              label: 'Delete item',
              value: 'approve',
              description: 'Delete only if the version still matches and it has no consumers.',
            },
          ],
          recommended: 0,
        },
      ],
    },
    createdAt: Date.now(),
    expiresAt: Date.now() + HITL_TTL_MS,
  }
  onUpdate?.({ request, action: input.action, key: input.key, approved: false } as never)

  let response: ApprovalResponse
  try {
    response = await context.humanInLoop.request<ApprovalRequest, ApprovalResponse>(request, signal)
  } catch (error) {
    return {
      content: isHitlTimeout(error)
        ? unansweredRefusal(`"${input.key}" still exists and was not touched.`)
        : `Vault deletion for "${input.key}" was not approved.`,
      details: { action: input.action, key: input.key, approved: false },
    }
  }
  const answer = response.payload.answers.find((entry) => entry.id === 'vault_delete')
  const approved =
    answer?.customInput === undefined && answer?.selectedOptions.includes('approve') === true
  if (!approved) {
    return {
      content: `Vault deletion for "${input.key}" was denied.`,
      details: { action: input.action, key: input.key, approved: false },
    }
  }

  const result = await remove(input.key, input.expected_version)
  const content =
    result.status === 'deleted'
      ? `Vault item "${input.key}" was deleted after explicit approval.`
      : result.status === 'in_use'
        ? `Vault item "${input.key}" is used by ${result.bindings.length} consumer(s) and was not deleted.`
        : result.status === 'conflict'
          ? `Vault item "${input.key}" changed to version ${result.currentVersion}; list it again before retrying.`
          : `Vault item "${input.key}" no longer exists.`
  return {
    content,
    details: {
      action: input.action,
      key: input.key,
      approved: true,
      status: result.status,
      ...(result.status === 'in_use' ? { consumerCount: result.bindings.length } : {}),
    },
  }
}

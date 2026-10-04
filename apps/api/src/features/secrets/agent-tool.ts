import type {
  AgentTool,
  AgentToolUpdateCallback,
  CallClass,
  HumanInLoopRequestBase,
  HumanInLoopResponseBase,
} from '@localixai/agent/agents'
import { TOOL } from '../agent-core/tool-names'
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
import type { VaultDeleteResult, VaultMutationResult } from './store'

import {
  vaultActionSchema,
  vaultInputSchema,
  type VaultToolInput,
  type VaultWireInput,
} from './vault-tool-schema'

export { vaultActionSchema, vaultInputSchema, type VaultToolInput } from './vault-tool-schema'

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

/** Vault actions that cannot complete without a human answering a prompt. */
const HUMAN_ONLY_VAULT_ACTIONS: ReadonlySet<VaultToolInput['action']> = new Set([
  'create',
  'rotate',
  'delete',
])

/**
 * What one vault call reaches. A static flag made the tool all-or-nothing: a read-only session
 * lost `list`/`get` with the writes, and an unattended one could not tell `update` (no person
 * needed) from `create` (a masked prompt nobody will see). Secrets are the agent's own durable
 * state, so every write is `host`; the three human-answered actions say so, and a delete cannot
 * be undone. Only the action is read — an unknown one is answered with the widest effect.
 */
export function classifyVaultCall(raw: unknown): CallClass {
  const action = raw && typeof raw === 'object' ? (raw as { action?: unknown }).action : null
  switch (action) {
    case 'list':
    case 'get':
      return { effect: 'read' }
    case 'update':
      return { effect: 'host' }
    case 'create':
    case 'rotate':
      return { effect: 'host', needsHuman: true }
    case 'delete':
      return { effect: 'host', needsHuman: true, irreversible: true }
    default:
      return { effect: 'external' }
  }
}

const metadataForModel = (item: SecretMeta) => ({
  key: item.key,
  title: item.label,
  description: item.description,
  type: item.type,
  source: item.source,
  reference: item.reference,
  tags: item.tags,
  version: item.version,
})

async function requestSecretValue(
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

async function approveDeletion(
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

/**
 * The agent's one Vault surface. Every action is value-free at the model
 * boundary; create/rotate values arrive through the isolated masked HITL channel.
 */
export function createVaultTool(options: {
  list: () => Promise<SecretMeta[]>
  updateMetadata: (
    key: string,
    request: {
      expectedVersion: number
      title?: string
      description?: string
      type?: SecretMeta['type']
      tags?: string[]
    },
  ) => Promise<VaultMutationResult>
  remove: (key: string, expectedVersion: number) => Promise<VaultDeleteResult>
}): AgentTool<VaultWireInput> {
  return {
    name: TOOL.vault,
    label: 'Vault',
    activeVerb: 'Managing Vault',
    description: [
      'Manage Vault item metadata. It NEVER accepts, reads or returns a secret value.',
      'Reference an item as secret:ALIAS only in trusted tools/plugins that resolve it server-side. A linked localix://resource/vault resource carries metadata only.',
    ].join('\n'),
    inputSchema: vaultInputSchema,
    executionMode: 'sequential',
    // Static: SOME action writes the vault. The per-call answer is `classify`.
    mutates: true,
    classify: classifyVaultCall,
    async execute(toolCallId, rawInput, signal, onUpdate, context) {
      const parsed = vaultActionSchema.safeParse(rawInput)
      if (!parsed.success) {
        return {
          content: `Invalid vault call: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}.`,
          isError: true,
        }
      }
      const input = parsed.data
      // create/rotate pause on the masked input overlay and delete on an approval card.
      // When this run has no surface a human is watching (`interactive === false`), the
      // host REFUSES to surface the request — which used to abort the whole run with an
      // "invalid ancestry" error. Decline just those three actions with something the
      // model can act on; `list`/`get`/`update` need no human and stay available.
      //
      // Not `interactiveOnly` on the tool: that would strip the metadata actions from
      // every non-chat run too, and would also deny a SUB-AGENT whose prompt does reach
      // the root chat. See run/hitl-reachable.ts.
      if (context?.interactive === false && HUMAN_ONLY_VAULT_ACTIONS.has(input.action)) {
        return {
          content: `Vault "${input.action}" needs the user's masked input or approval, and this run has no chat surface to show it on. Ask in a chat session (or have the orchestrator do it); list/get/update still work here.`,
          isError: true,
        }
      }

      if (input.action === 'list') {
        const needle = input.query?.toLocaleLowerCase()
        const items = (await options.list()).flatMap((item) => {
          if (input.type && item.type !== input.type) return []
          const matches =
            !needle ||
            `${item.label} ${item.key} ${item.description ?? ''} ${item.type} ${item.tags.join(' ')}`
              .toLocaleLowerCase()
              .includes(needle)
          return matches ? [metadataForModel(item)] : []
        })
        return {
          content: JSON.stringify({ items }),
          details: { action: input.action, count: items.length },
        }
      }

      if (input.action === 'get') {
        const item = (await options.list()).find((candidate) => candidate.key === input.key)
        return item
          ? {
              content: JSON.stringify({ item: metadataForModel(item) }),
              details: { action: input.action, key: input.key, found: true },
            }
          : {
              content: `Vault item "${input.key}" was not found.`,
              details: { action: input.action, key: input.key, found: false },
            }
      }

      if (input.action === 'create') {
        return requestSecretValue(toolCallId, input, undefined, signal, onUpdate, context)
      }

      if (input.action === 'rotate') {
        const existing = (await options.list()).find((candidate) => candidate.key === input.key)
        if (!existing) {
          return {
            content: `Vault item "${input.key}" was not found.`,
            details: { action: input.action, key: input.key, found: false },
            isError: true,
          }
        }
        if (existing.version !== input.expected_version) {
          return {
            content: `Vault item "${input.key}" changed to version ${existing.version}; get it again before retrying.`,
            details: {
              action: input.action,
              key: input.key,
              status: 'conflict',
              currentVersion: existing.version,
            },
            isError: true,
          }
        }
        return requestSecretValue(toolCallId, input, existing, signal, onUpdate, context)
      }

      if (input.action === 'update') {
        const { action: _action, key, expected_version: expectedVersion, ...metadata } = input
        const result = await options.updateMetadata(key, { expectedVersion, ...metadata })
        return result.status === 'updated'
          ? {
              content: JSON.stringify({ item: metadataForModel(result.item) }),
              details: { action: input.action, key, status: 'updated' },
            }
          : {
              content:
                result.status === 'conflict'
                  ? `Vault item "${key}" changed to version ${result.currentVersion}; get it again before retrying.`
                  : `Vault item "${key}" was not found.`,
              details: { action: input.action, key, status: result.status },
              isError: true,
            }
      }

      return approveDeletion(toolCallId, input, signal, onUpdate, context, options.remove)
    },
  }
}

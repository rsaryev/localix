import type { AgentTool, CallClass } from '@localixai/agent/agents'
import { TOOL } from '../agent-core/tool-names'
import type { SecretMeta } from './contracts'
import type { VaultDeleteResult, VaultMutationResult } from './store'
import { requestSecretValue, approveDeletion } from './agent-tool-human'

import {
  vaultActionSchema,
  vaultInputSchema,
  type VaultToolInput,
  type VaultWireInput,
} from './vault-tool-schema'

export { vaultActionSchema, vaultInputSchema } from './vault-tool-schema'

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

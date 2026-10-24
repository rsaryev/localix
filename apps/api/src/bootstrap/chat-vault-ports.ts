import { createVaultTool } from '../features/secrets/agent-tool'
import type { createChatService } from '../features/chat/service'
import type { createSecretExposureShield } from '../features/secrets/exposure-shield'
import type { createSecretsService } from '../features/secrets/service'
import type { createSecretsStore } from '../features/secrets/store'

type ChatServiceDeps = Parameters<typeof createChatService>[0]

/**
 * The vault ports chat is built with (`chat-service-deps.ts`): a resolve-only read for runtime
 * features that name a secret, the create-only write the `request_secret` answer uses, and the
 * agent's `vault` tool. Every value that passes through is registered with the exposure shield.
 */
export function createChatVaultPorts(deps: {
  secretsStore: ReturnType<typeof createSecretsStore>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  secretsService: ReturnType<typeof createSecretsService>
}): Pick<ChatServiceDeps, 'resolveSecret' | 'storeSecret' | 'vaultToolFor'> {
  const { secretsStore, secretExposureShield, secretsService } = deps
  return {
    // Resolve-only vault port for runtime features that name a secret — the mini app host's seam.
    resolveSecret: async (userId, key) => {
      const value = await secretsStore.resolve(userId, key, {
        actorType: 'agent',
        actorId: 'chat-runtime',
        consumerType: 'agent',
        consumerId: 'chat-runtime',
      })
      if (value) secretExposureShield.remember(userId, value)
      return value ?? undefined
    },
    // The create-only half of the vault (`setIfAbsent`, never `set`): the `request_secret`
    // answer leg (chatService.submitSecret) writes the typed value here and discards it.
    storeSecret: async (userId, request, value) => {
      // Registered on the WRITE, not only when something later resolves it: the user has just typed
      // this value into the HITL prompt and the very next turn is the one that uses it, so waiting for
      // a later `resolveSecret` leaves the whole first use unshielded — the same read-only gap the
      // provider-connection and MCP registrations closed.
      //
      // But only when the store ACCEPTED it. A review named the cost of registering first: a
      // `missing`/`conflict`/`exists` outcome would permanently redact a value the vault never held,
      // so a mistyped 12-plus-character non-secret (a long path, a branch name) would rewrite every
      // later mention of itself as `[vault-secret]` for the rest of the process.
      const audit = {
        actorType: 'agent' as const,
        actorId: 'chat-runtime',
        consumerType: 'agent',
        consumerId: 'request_secret',
      }
      if (request.action === 'rotate') {
        const result = await secretsStore.rotate(
          userId,
          request.key,
          value,
          request.expectedVersion!,
          audit,
        )
        if (result.status === 'updated') secretExposureShield.remember(userId, value)
        return result.status === 'updated'
          ? { stored: true, outcome: 'rotated' as const }
          : { stored: false, outcome: result.status as 'missing' | 'conflict' }
      }
      const stored = await secretsStore.setIfAbsent(userId, request.key, value, {
        label: request.label ?? request.key,
        description: request.description,
        type: request.type,
        source: 'user',
        tags: [...request.tags, 'agent-requested'],
        audit,
      })
      if (stored) secretExposureShield.remember(userId, value)
      return { stored, outcome: stored ? ('created' as const) : ('exists' as const) }
    },
    vaultToolFor: (userId) =>
      createVaultTool({
        list: () => secretsService.list(userId),
        updateMetadata: (key, request) =>
          secretsStore.updateMetadata(userId, key, request, {
            actorType: 'agent',
            actorId: 'chat-runtime',
            consumerType: 'agent',
            consumerId: 'vault',
          }),
        remove: (key, expectedVersion) =>
          secretsStore.remove(userId, key, {
            expectedVersion,
            audit: {
              actorType: 'agent',
              actorId: 'chat-runtime',
              consumerType: 'agent',
              consumerId: 'vault',
            },
          }),
      }),
  }
}

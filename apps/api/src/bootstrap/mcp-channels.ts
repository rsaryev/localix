/**
 * Claude Code channels, composed: where a channel's bindings are kept and how they come back at
 * boot, and the permission relay between a chat's approval cards and its channels.
 *
 * Here because each half reaches across features — the MCP manager owns the channels, chat owns
 * the cards and the answer path, plugins own their servers' records — and only the composition
 * root may join them (A4).
 */
import type { Kysely } from 'kysely'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import type { AppDatabase } from '../db/types'
import { userHome } from '../lib/env'
import { readAvailability } from '../features/capabilities/availability'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import type { HitlLifecycleObserver, HitlRaised } from '../features/attention/sources'
import { createChannelBindingRepository } from '../features/mcp/channel-binding-repository'
import { mcpClientManager } from '../features/mcp/client-manager'
import type { ChannelBinding } from '../features/mcp/mcp-channels'
import type { PermissionPrompt } from '../features/mcp/mcp-channel-permissions'
import { createMcpRepository, type McpServerRecord } from '../features/mcp/repository'
import { loadEnabledPluginMcpServers } from '../features/plugins/loader-mcp-declarative'

type Manager = Pick<typeof mcpClientManager, 'channelPermissionOpened' | 'channelPermissionClosed'>

/** Claude Code's description when a shell call gives none: never the command itself. */
const SHELL_DESCRIPTION = 'Run shell command'

/** An approval card as the relay sends it; null for any other prompt. */
export function permissionPromptOf(raised: HitlRaised): PermissionPrompt | null {
  const interaction = raised.interaction as
    | {
        toolName?: string
        request?: { kind?: string; title?: string; payload?: Record<string, unknown> }
      }
    | undefined
  const request = interaction?.request
  if (!raised.userId || request?.kind !== 'confirm') return null
  const payload = request.payload ?? {}
  const subject = typeof payload.subject === 'string' ? payload.subject : 'command'
  const command = typeof payload.command === 'string' ? payload.command : ''
  const field = subject === 'path' ? 'path' : subject === 'resource' ? 'resource' : 'command'
  return {
    userId: raised.userId,
    sessionId: raised.sessionId,
    hostRequestId: raised.requestId,
    toolName: interaction?.toolName ?? 'tool',
    description:
      subject === 'command'
        ? SHELL_DESCRIPTION
        : request.title?.trim() || interaction?.toolName || '',
    // The card's own payload: already shielded, so a vault value never reaches a channel.
    input: {
      [field]: command,
      ...(typeof payload.cwd === 'string' ? { cwd: payload.cwd } : {}),
    },
  }
}

/** The chat's approval lifecycle, also told to the channels speaking into each chat. */
export function withChannelPermissionRelay(
  observer: HitlLifecycleObserver | undefined,
  manager: Manager = mcpClientManager,
): HitlLifecycleObserver {
  return {
    raised(request) {
      observer?.raised(request)
      const prompt = permissionPromptOf(request)
      if (prompt) manager.channelPermissionOpened(prompt)
    },
    ended(ending) {
      observer?.ended(ending)
      manager.channelPermissionClosed(ending.requestId)
    },
  }
}

/** The server a kept binding names, when it is still offered and available in its scope. */
export function channelServerResolver(
  db: Kysely<AppDatabase>,
  loadPluginServers: typeof loadEnabledPluginMcpServers = loadEnabledPluginMcpServers,
): (binding: ChannelBinding) => Promise<McpServerRecord | null> {
  const mcpRepo = createMcpRepository(db)
  return async (binding) => {
    const availability = await readAvailability(db, {
      userId: binding.userId,
      agentId: DEFAULT_AGENT_ID,
    })
    const server = binding.serverId.startsWith('plugin:')
      ? (
          await loadPluginServers({
            repo: createCapabilitySourceRepository(db, 'plugin'),
            availability,
            userId: binding.userId,
            projectId: binding.projectId,
            cwd: binding.cwd,
            homeDir: userHome(),
          })
        ).find((record) => record.id === binding.serverId)
      : await mcpRepo.getById(binding.userId, binding.serverId)
    if (!server || availability.effectFor('mcp', server.name) === 'deny') return null
    // A server the person added is a channel only while they keep it opted in.
    if (!server.id.startsWith('plugin:') && server.config.channel !== true) return null
    return server
  }
}

/**
 * Keep bindings in the database, start the kept ones again, and let a channel's verdict answer
 * the card it names through the same path a click takes. Called once, after chat exists.
 */
export function startMcpChannels(input: {
  db: Kysely<AppDatabase>
  answer: (userId: string, requestId: string, allow: boolean) => { ok: boolean }
  logger: { warn(message: string, meta?: unknown): void }
}): Promise<number> {
  const store = createChannelBindingRepository(input.db)
  mcpClientManager.keepChannelBindings(store)
  mcpClientManager.answerChannelPermissions(
    ({ userId, hostRequestId, allow }) => input.answer(userId, hostRequestId, allow).ok,
  )
  return mcpClientManager
    .restoreChannels(store, channelServerResolver(input.db), {
      warn: (...args) => input.logger.warn(...args),
    })
    .catch((err: unknown) => {
      input.logger.warn('MCP channels were not restored', { error: String(err) })
      return 0
    })
}

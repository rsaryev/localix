import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { Kysely } from 'kysely'
import type { LanguageModelFactory } from '@localixai/agent/runtime'
import type { AppDatabase } from '../db'
import type { PersistedMessage } from '../features/chat/contracts'
import { readAvailability } from '../features/capabilities/availability'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import type { CatalogService } from '../features/catalog/service'
import { createAuxProviderHelpers } from '../features/chat/service/aux-provider'
import { listDelegatedRuns } from '../features/chat/service/delegated-runs'
import { createUsageRepository } from '../features/usage/repository'
import { createUserProfileRepository } from '../features/user/repository'
import { pluginDataDir } from '../features/ext/user-config-substitute'
import type { ModelCompletion, ModsPorts } from '../features/mods/contracts'
import { receiveDelivery } from '../features/mods/conversation-events'
import { createModsHost, type ModsHost } from '../features/mods/host'
import { loadEnabledPluginMods } from '../features/plugins/loader-declarative'
import type { ProviderConnectionsService } from '../features/provider-connections/service'
import type { RealtimeResource } from '../features/realtime/resources'
import type { BootstrapServiceRefs } from './chat-service-deps'
import { sessionReadOf } from './mods-session'
import type { PluginHostRefs } from './plugin-host-refs'
import { createDebouncer, createThrottle } from '../lib/debounce'
import { localixWorkspaceDir, userHome } from '../lib/env'
import type { createLogger } from '../lib/logger'

/**
 * The mods host for this process (`features/mods`), its ports bound to Localix. Built before chat,
 * which runs every turn through it; the ports that need chat (a wake, a session's model route,
 * the transcript) read it through `chat()` once it exists. `refresh` reloads the enabled plugins'
 * hooks modules after any plugin change, debounced like the other plugin hosts.
 */

const REFRESH_DEBOUNCE_MS = 500
/** Panes redraw on a poke; a mod that invalidates in a loop is held to a few pokes a second. */
const PANES_POKE_MS = 100

interface ChatPorts {
  getSessionAgentRoute(
    userId: string,
    sessionId: string,
  ): Promise<{ providerConnectionId: string | null; modelId: string | null } | null>
  streamRegistry: { publish(userId: string, sessionId: string, event: unknown): void }
  stop(sessionId: string, callerUserId?: string): Promise<boolean>
}

interface Wakes {
  send(
    request: {
      userId: string
      sessionId: string
      content: string
      source: 'external'
      coalesce?: string
    },
    label: string,
  ): unknown
}

export function createModsPhase(input: {
  infra: {
    db: Kysely<AppDatabase>
    logger: ReturnType<typeof createLogger>
    env: { LOCALIX_DEFAULT_USER_ID: string }
    catalogService: CatalogService
    providerConnectionsService: ProviderConnectionsService
    languageModelFactory: LanguageModelFactory
    serviceRefs: BootstrapServiceRefs
    bootRepo: { listMessages(userId: string, sessionId: string): Promise<PersistedMessage[]> }
  }
  hostRefs: PluginHostRefs
}): { modsHost: ModsHost; refreshMods: () => void } {
  const { infra, hostRefs } = input
  const deps = {
    ...infra,
    chat: (): ChatPorts | undefined => hostRefs.chatService,
    wakes: (): Wakes | undefined => hostRefs.wakes,
  }
  const { logger } = deps
  const defaultUserId = infra.env.LOCALIX_DEFAULT_USER_ID
  const aux = createAuxProviderHelpers({
    userProfileRepo: createUserProfileRepository(deps.db),
    catalogService: deps.catalogService,
    providerConnectionsService: deps.providerConnectionsService,
    languageModelFactory: deps.languageModelFactory,
  })
  const publish = (userId: string, resources: RealtimeResource[]) =>
    deps.chat()?.streamRegistry.publish(userId || defaultUserId, '', {
      type: 'resources.changed',
      resources,
    })
  const pokes = createThrottle(PANES_POKE_MS)
  const notice = (userId: string, sessionId: string, message: string, hookEvent: string) =>
    deps.chat()?.streamRegistry.publish(userId, sessionId, {
      type: 'hook.notice',
      sessionId,
      message,
      hookEvent,
    })

  const ports: ModsPorts = {
    dataDir: (plugin) => pluginDataDir(plugin, userHome()),
    workspaceDir: localixWorkspaceDir(),
    async submitPrompt(scene, input) {
      const wakes = deps.wakes()
      if (!scene.sessionId || !wakes) throw new Error('$.prompt.submit needs a conversation')
      // Claude names the sender of a prompt a mod submits, unless it is the person's own words.
      const content = input.asUser ? input.text : `[${input.plugin}] ${input.text}`
      wakes.send(
        {
          userId: scene.userId || defaultUserId,
          sessionId: scene.sessionId,
          content,
          source: 'external',
          coalesce: `mod:${input.plugin}`,
        },
        `mod ${input.plugin}`,
      )
    },
    async complete(scene, request): Promise<ModelCompletion> {
      const userId = scene.userId || defaultUserId
      const route = scene.sessionId
        ? await deps
            .chat()
            ?.getSessionAgentRoute(userId, scene.sessionId)
            .catch(() => null)
        : null
      const modelId = request.model ?? route?.modelId
      if (!modelId) return { isAnswered: false, reason: 'no model: open the mod in a conversation' }
      const built = await aux
        .buildLanguageModel(userId, modelId, route?.providerConnectionId)
        .catch(() => null)
      if (!built) return { isAnswered: false, reason: `the model ${modelId} is not available` }
      // `$.model.fork`: the conversation so far, as the transcript the one question follows.
      const transcript = (request.history ?? [])
        .map(({ role, text }) => `${role === 'user' ? 'User' : 'Assistant'}: ${text}`)
        .join('\n\n')
      const message = await built.model.complete({
        systemPrompt: request.system ?? '',
        messages: [
          {
            role: 'user',
            content: transcript
              ? `The conversation so far:\n\n${transcript}\n\n${request.prompt}`
              : request.prompt,
            timestamp: Date.now(),
          },
        ],
        maxOutputTokens: Math.min(request.maxTokens ?? 1024, 64_000),
        reasoningEffort: 'off',
        ...(scene.sessionId ? { sessionId: scene.sessionId } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      })
      const usage = message.usage
      return {
        isAnswered: true,
        text: textOf(message.content),
        ...(usage
          ? {
              usage: {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                cache_read_input_tokens: usage.cacheReadTokens ?? 0,
                cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
              },
            }
          : {}),
      }
    },
    log(scene, { plugin, text }) {
      if (scene.sessionId) notice(scene.userId || defaultUserId, scene.sessionId, text, plugin)
      else logger.info({ event: 'mod.log', plugin, text })
    },
    notify(scene, { plugin, text }) {
      if (scene.sessionId) notice(scene.userId || defaultUserId, scene.sessionId, text, plugin)
      else logger.info({ event: 'mod.notify', plugin, text })
    },
    homeDir: userHome(),
    async abortTurn(scene) {
      if (!scene.sessionId) throw new Error('turn.abort: no conversation to stop')
      await deps.chat()?.stop(scene.sessionId, scene.userId || defaultUserId)
    },
    async listAgentRuns(scene) {
      if (!scene.sessionId) return []
      const runs = await listDelegatedRuns(
        infra.db,
        createUsageRepository(infra.db),
        scene.userId || defaultUserId,
        scene.sessionId,
        { usage: false },
      )
      return runs.map((run) => ({
        sessionId: run.sessionId,
        taskName: run.taskName,
        status: run.status,
        ...(run.agentId ? { agentId: run.agentId } : {}),
        ...(run.parentSessionId ? { parentSessionId: run.parentSessionId } : {}),
      }))
    },
    async readSession(scene) {
      if (!scene.sessionId) return null
      const userId = scene.userId || defaultUserId
      const [messages, route] = await Promise.all([
        infra.bootRepo.listMessages(userId, scene.sessionId),
        deps
          .chat()
          ?.getSessionAgentRoute(userId, scene.sessionId)
          .catch(() => null),
      ])
      return sessionReadOf(messages, route?.modelId ?? null)
    },
    changed: () => pokes.schedule(() => publish(defaultUserId, ['mods'])),
    report: (plugin, message) => logger.warn({ event: 'mod.problem', plugin, message }),
  }

  const modsHost = createModsHost(ports)
  const repo = createCapabilitySourceRepository(deps.db, 'plugin')
  const debounce = createDebouncer(REFRESH_DEBOUNCE_MS)
  const reconcile = async () => {
    const mods = await loadEnabledPluginMods({
      repo,
      availability: await readAvailability(deps.db, {
        userId: defaultUserId,
        agentId: DEFAULT_AGENT_ID,
      }),
      userId: defaultUserId,
      homeDir: userHome(),
    })
    await modsHost.reconcile(mods.map((mod) => ({ ...mod })))
    publish(defaultUserId, ['mods', 'capabilities'])
  }
  const refreshMods = () =>
    debounce.schedule(
      () =>
        void reconcile().catch((error: unknown) =>
          logger.warn({ event: 'mods.refresh_failed', error: String(error) }),
        ),
    )
  // Chat reads the host through its refs, and a plugin change reloads the mods (domain-services).
  infra.serviceRefs.modsHost = modsHost
  hostRefs.mods = {
    refresh: refreshMods,
    commands: () => modsHost.registry.commands(),
    receive: (delivery) => receiveDelivery(modsHost, delivery),
  }
  return { modsHost, refreshMods }
}

/** The text of a model reply: its text parts, joined. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? [
            typeof (part as { text?: unknown }).text === 'string'
              ? (part as { text: string }).text
              : '',
          ]
        : [],
    )
    .join('')
}

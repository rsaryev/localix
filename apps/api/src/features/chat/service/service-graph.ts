/**
 * The chat service's OBJECT GRAPH: every long-lived collaborator a `ChatService`
 * is built out of — repositories, the sub-services it owns, the process-wide
 * registries, and the agent runner wired to all of them.
 *
 * It exists so `createChatService` reads as what it is — an API surface over a
 * graph — instead of interleaving ~100 lines of construction with the operations.
 * The knowledge that lives HERE (and nowhere else) is *which collaborator gets
 * which registry*: the preview relay pair, the agent-edit services the runner and command
 * handlers must share, and the
 * runner's dependency map.
 *
 * It closes over `deps` alone — no request- or run-scoped values reach it — so it
 * is constructed once, up front, and hands back a plain bag the service
 * destructures. Everything that needs a session (`requireSession`, the working-dir
 * resolver, the file watcher) is formed over it in `session-core.ts`, and the
 * per-use-case contexts in `operation-contexts.ts`.
 */
import { createChatRepository } from '../repository'
import { withResolvedRoutes } from './session-route-backfill'
import { createRouteDefaults } from './session-route-defaults'
import { readAgentSettings } from './agent-settings'
import { normalizeProjectSettings } from '../../projects/contracts'
import { safeJsonParse } from '../../../lib/json'
import { createAgentRunner, type AgentRunner } from '../runtime/agent-runner'
import { createHitlRegistry, type HitlRegistry } from '../runtime/hitl-registry'
import { createMiniAppCommandRegistry } from '../runtime/mini-app-command-registry'
import { createPreviewCommandRegistry } from '../runtime/preview-command-registry'
import { createSessionStreamRegistry } from '../runtime/session-stream-registry'
import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import { resolveDefaultUserId } from '../../../lib/env'
import type { ChatServiceDeps } from './context'
import { renderSkillBody, withSkillShellPolicy } from './skill-render'

export function createChatServiceGraph(deps: ChatServiceDeps) {
  const now = deps.now ?? (() => new Date().toISOString())

  const { ports } = deps
  const { projectsRepo, miniAppService } = ports
  // A seat stores its route explicitly. The wrapper only fills a legacy blank seat once and
  // writes it back; new seats are decided at birth by `routeDefaults.seatRoute`.
  const baseRepo = createChatRepository(deps.db)
  const routeDefaults = createRouteDefaults({
    loadProjectModelDefaults: async (userId, projectId) => {
      const project = await projectsRepo.getProject(userId, projectId)
      const settings = normalizeProjectSettings(safeJsonParse<unknown>(project?.settings))
      if (!settings) return null
      return {
        ...(settings.modelId !== undefined ? { modelId: settings.modelId } : {}),
        ...(settings.providerConnectionId !== undefined
          ? { providerConnectionId: settings.providerConnectionId }
          : {}),
      }
    },
    ...(deps.loadAgentModelDefaults ? { loadAgentModelDefaults: deps.loadAgentModelDefaults } : {}),
    loadRecentRoutes: (userId) => baseRepo.listRecentRoutes(userId),
    loadAgentModelSettings: async (userId) =>
      (await readAgentSettings(ports.userProfileRepo, userId))?.agentModelSettings ?? [],
  })
  const repo = withResolvedRoutes(baseRepo, routeDefaults)
  const streamRegistry = deps.streamRegistry ?? createSessionStreamRegistry()
  const hitlRegistry: HitlRegistry =
    deps.hitlRegistry ??
    createHitlRegistry({
      // An approval card's payload is built from the raw tool input, and three consumers read it
      // (the wire, mini app hooks, the reconnect detail) — see HitlRegistryOptions.
      sanitizePayload: deps.sanitizeToolInput
        ? (userId, payload) => (userId ? deps.sanitizeToolInput!(userId, payload) : payload)
        : undefined,
      // A request that expired or lost its run settles on every client the same way an answered
      // one does; otherwise its card and its Event Center row stay "Respond" forever.
      onClearedUnanswered: ({ requestId, meta, reason }) =>
        streamRegistry.publish(meta.userId ?? resolveDefaultUserId(), meta.sessionId, {
          type: 'hitl.resolved',
          sessionId: meta.sessionId,
          requestId,
          reason,
        }),
      // The same request's row in the notification journal: raised here, settled by its ending.
      lifecycle: deps.notifications?.hitl,
    })
  // Relay for the `browser` tool: publishes commands on the firehose and
  // parks a promise the host UI resolves via the `preview-result` WS RPC. Driving the
  // user's own iframe preview through its injected probe is the ONLY preview-control
  // backend (the external headless-browser backend was removed).
  const previewRegistry = createPreviewCommandRegistry({ streamRegistry })
  // Awaitable mini app→UI command relay (`emitCommandWithReply`): publishes a
  // `mini-app.command` frame and parks a promise the client sink settles via the
  // `mini-app-command-result` WS RPC — the preview relay's generic sibling.
  const miniAppCommands = createMiniAppCommandRegistry({ streamRegistry })
  // Per-session preview-target registry: bash records a detected dev-server URL here,
  // and browser lazily auto-opens it on the first drive action (the single
  // instance is shared by both via the runner deps).
  const runner: AgentRunner =
    deps.runner ??
    createAgentRunner({
      db: deps.db,
      ports,
      work: deps.work,
      notifications: deps.notifications,
      // The RESOLVED reader, so a wake the runner starts from its own read of a session sees
      // the same models a typed turn does. See `RunnerDeps.repo`.
      repo,
      providerConnectionsService: deps.providerConnectionsService,
      catalogService: deps.catalogService,
      hitlRegistry,
      streamRegistry,
      agentRuntime: deps.agentRuntime,
      languageModelFactory: deps.languageModelFactory,
      ...(deps.scripts ? { scripts: deps.scripts } : {}),
      uiLocationCatalog: deps.uiLocationCatalog,
      logger: deps.logger,
      lspManager: deps.lspManager,
      spawnTerminalJob: deps.spawnTerminalJob,
      readTerminalJob: deps.readTerminalJob,
      terminalControl: deps.terminalControl,
      previewControl: previewRegistry,
      miniAppCommands,
      miniAppAuthoring: miniAppService.authoring,
      // Read lazily: `deps.monitors` is a forward-holder getter (bootstrap/chat-service-deps),
      // so a snapshot taken here would be the `undefined` from before the service exists.
      get monitors() {
        return deps.monitors
      },
      get exitNotices() {
        return deps.exitNotices
      },
      get mods() {
        return deps.mods
      },
      get configProposals() {
        return deps.configProposals
      },
      get plans() {
        return deps.plans
      },
      get globalSearch() {
        return deps.globalSearch
      },
      get store() {
        return deps.store
      },
      get editorBufferText() {
        return deps.editorBufferText
      },
      mediaStore: deps.mediaStore,
      documentExtract: deps.documentExtract,
      announceCapabilityChange: deps.announceCapabilityChange,
      renderSkill: withSkillShellPolicy(renderSkillBody, deps.skillShellDisabled),
      resolveSecret: deps.resolveSecret,
      vaultToolFor: deps.vaultToolFor,
      externalAgents: deps.externalAgents,
      sanitizeToolResult: deps.sanitizeToolResult,
      sanitizeToolError: deps.sanitizeToolError,
      sanitizeToolInput: deps.sanitizeToolInput,
      sanitizeText: deps.sanitizeText,
      persistPermissionRule: deps.persistPermissionRule,
      listInvocableRegistryAgents: deps.listInvocableRegistryAgents,
      listRegistryAgents: deps.listRegistryAgents,
      resolveMainAgent: deps.resolveMainAgent,
      ...(deps.vectors ? { vectors: deps.vectors } : {}),
      ...(deps.decisions ? { decisions: deps.decisions } : {}),
      agentManagement: deps.agentManagement,
      now: deps.now,
    })

  return {
    now,
    repo,
    routeDefaults,
    ...ports,
    hitlRegistry,
    streamRegistry,
    previewRegistry,
    miniAppCommands,
    runner,
    // Serializes every write-path mutation of ONE session (send / edit / rollback /
    // fork / thread append / external turn) so two concurrent entries can never
    // interleave a read-modify-write of the same message tree. "FIFO-serialize async
    // work per key" is `lib/keyed-serializer.ts`'s algorithm — keyed by sessionId.
    withSessionMutationLock: createKeyedSerializer(),
  }
}

export type ChatServiceGraph = ReturnType<typeof createChatServiceGraph>

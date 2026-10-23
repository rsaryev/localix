import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono, type Context } from 'hono'

import type { Logger } from './lib/logger'
import { createRootErrorHandler, jsonError } from './lib/http'
import { createHealthRoutes } from './health'
import { errorMessage } from './lib/errors'
import { createRequestBoundary } from './lib/request-boundary'
import { escapeHtml } from './lib/html-escape'
import { createUiStaticHandler } from './lib/ui-static'
import {
  createLocalOriginBoundary,
  createLocalOriginPolicy,
  type LocalOriginPolicy,
} from './lib/local-origin-guard'
import { createCatalogRoutes, type CatalogRoutesService } from './features/catalog/routes'
import { ownedAgentRoutes } from './bootstrap/owned-agent-routes'
import { createAgentSessionsRoutes } from './features/external-agents/backend/routes'
import type { AgentSessionsService } from './features/external-agents/backend/service'
import { createChatRoutes, type ChatRoutesService } from './features/chat/routes'
import {
  createProviderConnectionsRoutes,
  type ProviderConnectionsRoutesService,
} from './features/provider-connections/routes'
import { createProjectsRoutes, type ProjectsRoutesService } from './features/projects/routes'
import { createUserRoutes, type UserRoutesService } from './features/user/routes'
import { createToolsRoutes, type ToolGcSource } from './features/tools/routes'
import {
  createEffectiveConfigRoutes,
  type EffectiveConfigRoutesService,
} from './features/effective-config/routes'
import {
  createCapabilityRoutes,
  type CapabilityRoutesService,
} from './features/capabilities/routes'
import { createMcpRoutes, type McpRoutesService } from './features/mcp/routes'
import { createPluginRoutes, type PluginRoutesService } from './features/plugins/routes'
import { createMiniAppRoutes, type MiniAppRoutesService } from './features/mini-apps/routes'
import {
  holdMiniAppRoutesUntilWired,
  type MiniAppRouteHost,
} from './features/mini-apps/plugin-route-boot-hold'
import { createAgentsRoutes, type AgentsRoutesService } from './features/agents/routes'
import { createSkillsCuratorRoutes } from './features/skills-curator/routes'
import type { SkillsCuratorService } from './features/skills-curator/service'
import { createNotificationRoutes, type NotificationJournal } from './features/notifications'
import { createMediaRoutes } from './features/media/routes'
import { MEDIA_SERVE_PREFIX } from './features/media/serve-path'
import type { MediaStore } from './features/media/store'
import { createSystemRoutes } from './features/system/routes'
import { clientEvent } from './features/mods/conversation-events'
import { createModRoutes } from './features/mods/routes'
import { createModsHost, INERT_MOD_PORTS, type ModsHost } from './features/mods/host'
import { createStorageRoutes } from './features/storage/routes'
import type { StorageService } from './features/storage/service'
import { createShellCommandRoutes } from './features/shell-command/routes'
import type { ShellCommandService } from './features/shell-command/service'
import type { SystemService } from './features/system/service'
import type { WsFrameRegistry } from './features/ext/ws-frame-registry'
import { createSecretsRoutes } from './features/secrets/routes'
import { createResourceRefRoutes } from './features/resource-refs/routes'
import type { ResourceProviderRegistry } from './features/agent-core/resource-refs/provider'
import { createSearchRoutes } from './features/search/routes'
import { createSemanticRoutes } from './features/embeddings/routes'
import { createLocalModelsRoutes } from './features/local-models/routes'
import type { LocalModelsService } from './features/local-models/service'
import type { SemanticService } from './features/embeddings/service'
import type { SearchService } from './features/search/service'
import type { SecretsService } from './features/secrets/service'
import { createRealtimeRoute } from './features/realtime/ws'
import type { LspDocumentService } from './features/lsp'
import type { InlineCompletionService } from './features/suggest/service'
import type { NextEditService } from './features/edit-prediction/engine'
import { createTerminalRoutes } from './features/terminal/routes'
import { createTerminalStreamRoute } from './features/terminal/ws'
import { createPreviewRoutes, type PreviewRoutesDeps } from './features/preview/routes'
import { createWebhookRoutes } from './features/webhook/routes'
import { createConversationRoutes, type ConversationRouteDeps } from './conversation-routes'
import { WEBHOOK_MOUNT_PATH } from './lib/runtime-address'
import type { TerminalService } from './features/terminal/service'
import type { WorkRegistry } from './features/work/registry'
import {
  getPreviewProbeJs,
  getNativeBrowserProbeJs,
} from './features/agent-core/tools/preview/preview-probe'
import type { HostRouteContext } from '@localixai/mini-app-sdk/backend'
import { createUiLocationCatalogRoutes } from './features/ui-locations/routes'
import type { UiLocationCatalogService } from './features/ui-locations/service'

export type AppContext = HostRouteContext

// The plan, Continue, attention and comments deps (`./conversation-routes`).
export interface AppDeps extends ConversationRouteDeps {
  externalAgents?: AgentSessionsService
  runtimeInfo?: {
    instanceId: string
    startedAt: string
    databaseId?: string
    isDraining?: () => boolean
  }
  logger: Logger
  defaultUserId: string
  catalogService: CatalogRoutesService
  chatService: ChatRoutesService
  providerConnectionsService: ProviderConnectionsRoutesService
  projectsService: ProjectsRoutesService
  userService: UserRoutesService
  /** Read-only effective-agent-configuration diagnostics (`GET /rpc/effective-config`). */
  effectiveConfigService: EffectiveConfigRoutesService
  /** ONE versioned answer to "what can this scope do" (`GET /rpc/capabilities/snapshot`). */
  capabilitySnapshotService: Pick<CapabilityRoutesService, 'getSnapshot'>
  capabilityApplyService: { apply: CapabilityRoutesService['applyRules'] }
  /** One scope's own permission rules — read and replace. */
  capabilityPermissions: Pick<CapabilityRoutesService, 'readRules' | 'writeRules'>
  /**
   * The tool-GC report's two extra reads (usage counters + the scope's budget threshold).
   * Optional: the endpoint answers 503 without it rather than the tool catalog going down with
   * a feature that only reports.
   */
  toolGcSource?: ToolGcSource
  mcpService: McpRoutesService
  pluginService: PluginRoutesService
  miniAppService: MiniAppRoutesService
  agentsService: AgentsRoutesService
  skillsCuratorService: SkillsCuratorService
  /** The notification journal — the Event Center's single source of truth. */
  notifications: NotificationJournal
  /** Filesystem media store — serves uploaded media bytes by content id. */
  mediaStore: MediaStore
  systemService: SystemService
  /** Claude Code mods: their panes and controls (`/rpc/mods`). Absent in lightweight harnesses. */
  modsHost?: ModsHost
  /** Disk usage and removal of old conversations (`/rpc/storage`). */
  storageService: StorageService
  /** `localix` shell-command install ("install in PATH"). */
  shellCommandService: ShellCommandService
  /** LIVE plugin-route dispatcher — the backend host's stable middleware serving
   *  each wired subsystem's '/rpc/<id>' from a mutable mount table, so a hot
   *  plugin toggle adds/removes routes with no restart. Optional so lightweight
   *  test harnesses can build the app without it. */
  pluginBackendHost?: MiniAppRouteHost
  /** Generic WS-frame registry — subsystem-contributed live streams that the
   *  realtime socket consults for unrecognized subscribe/unsubscribe commands.
   *  Optional so lightweight test harnesses can build the app without it. */
  wsFrameRegistry?: WsFrameRegistry
  /** Resource-ref provider registry — backs the `@resource:` drill-down menu route. */
  resourceRefsRegistry: ResourceProviderRegistry
  /** Global search — ONE endpoint fanning a query across every domain provider. */
  searchService: SearchService
  /** Semantic search: model install, index state and its settings actions. */
  semanticService: SemanticService
  /** Models on this computer: catalog, downloads and the model server. */
  localModelsService: LocalModelsService
  /** Frontend-published, immutable UI destination catalogs for agent discovery. */
  uiLocationCatalogService: UiLocationCatalogService
  /** Central secrets store — write-only values referenced by `secret:<KEY>` handles. */
  secretsService: SecretsService
  terminalService: TerminalService
  work: WorkRegistry
  /** Inspector-editor ↔ language-server document sync (drives `lsp.diagnostics`). */
  lspDocumentService: LspDocumentService
  /** Shared chat/commit text-input completion — auxiliary LLM call. */
  inlineCompletionService: InlineCompletionService
  /** Edit prediction (a single next line-range edit) — auxiliary LLM call. */
  nextEditService: NextEditService
  /** Open a live preview for a URL on behalf of the UI (background-jobs strip's
   *  "Open preview"). Bound in bootstrap to the publish-capable stream registry. */
  openPreview: PreviewRoutesDeps['openPreview']
  /** When set, serve the pre-built UI from this directory on all non-API routes. */
  uiDir?: string
  /**
   * Which Host names and page origins may drive this API (`lib/local-origin-guard.ts`), built
   * once at boot from the environment. Optional only so test harnesses can omit it: absent, the
   * strictest policy applies (loopback hosts, the packaged app's origins), never an open one.
   */
  originPolicy?: LocalOriginPolicy
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppContext>()

  // FIRST, before every route (websocket upgrades and plugin routes included): a foreign page or
  // a DNS-rebound name must never reach a handler — see `lib/local-origin-guard.ts`. Absent a
  // policy (lightweight harnesses) the strictest one applies: packaged origins only.
  const originPolicy =
    deps.originPolicy ?? createLocalOriginPolicy({ servesUi: Boolean(deps.uiDir) })
  app.use('*', ...createLocalOriginBoundary(originPolicy, deps.logger))

  app.use('*', createRequestBoundary(deps.defaultUserId, deps.logger))

  // Desktop OAuth callback handler. The system browser redirects here (with
  // ?code=&state=) after the user authorizes with a provider. Shared by the
  // dedicated `/oauth` route and the root `/` guard below so desktop flows can
  // use the provider's registered root callback URL (`http://localhost:<port>/`).
  const handleOAuthCallback = async (c: Context<AppContext>) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    try {
      await deps.providerConnectionsService.completeOAuth(c.get('userId'), {
        code: code!,
        state: state!,
      })
    } catch (e) {
      // Escaped: the message can echo provider-supplied text (an `error_description`, a state
      // the flow did not issue), and this page is served from the API's own origin, so raw HTML
      // in it would run script with the right to drive every route.
      const msg = escapeHtml(errorMessage(e))
      return c.html(
        `<html><body style="font-family:system-ui;padding:2rem;background:#111;color:#fff"><h2>Authentication failed</h2><p>${msg}</p></body></html>`,
        400,
      )
    }
    return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}
.card{text-align:center;padding:2rem 3rem;background:#1e1e1e;border-radius:1rem;border:1px solid #333}
h2{margin:0 0 .5rem}p{margin:0;color:#888;font-size:.9rem}</style></head>
<body><div class="card"><h2>Connected</h2><p>You can close this tab and return to LocalixAI.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`)
  }

  // LIVE plugin-route dispatcher (a bundled subsystem's '/rpc/<id>'). Mounted on
  // `app` HERE — before the fluent chain below mounts the '/rpc' chat catch-all —
  // so a wired subsystem's distinct path wins over the catch-all, exactly like the
  // static `app.route()` loop this replaces. The dispatcher reads the backend
  // host's mount table PER REQUEST, so a hot plugin toggle adds/removes routes
  // with no restart; an unmatched path falls through to `next()` (the same 404 a
  // never-mounted route produced). These routes are untyped (not part of the
  // exported AppType) — subsystem UIs use untyped fetch. A request nothing answered
  // before the first reconcile waits for it instead of reading a 404 as "no plugin".
  if (deps.pluginBackendHost) app.use('*', holdMiniAppRoutesUntilWired(deps.pluginBackendHost))

  // Liveness probe — dependency-free, so it lives in its own module and is mounted
  // here rather than declared inline in the typed chain below (see health.ts).
  app.route('/', createHealthRoutes(deps.runtimeInfo))

  const routes = app
    // Root: complete the OAuth callback when ?code= is present, otherwise fall
    // through (to the UI/static handler in web mode). This makes the desktop
    // callback URL identical to the web one.
    .get('/', async (c, next) => {
      if (c.req.query('code') && c.req.query('state')) return handleOAuthCallback(c)
      return next()
    })
    .get('/oauth', async (c) => {
      if (!c.req.query('code') || !c.req.query('state')) {
        return c.html(
          '<html><body style="font-family:system-ui;padding:2rem"><h2>Missing parameters.</h2></body></html>',
          400,
        )
      }
      return handleOAuthCallback(c)
    })
    .route(
      '/rpc/provider-connections',
      createProviderConnectionsRoutes(deps.providerConnectionsService),
    )
    .route('/rpc/models/catalog', createCatalogRoutes(deps.catalogService))
    .route('/rpc/projects', createProjectsRoutes(deps.projectsService))
    .route('/rpc/user', createUserRoutes(deps.userService))
    .route('/rpc/tools', createToolsRoutes(deps.toolGcSource))
    .route('/rpc/effective-config', createEffectiveConfigRoutes(deps.effectiveConfigService))
    .route(
      '/rpc/capabilities',
      createCapabilityRoutes({
        getSnapshot: (...args) => deps.capabilitySnapshotService.getSnapshot(...args),
        applyRules: (...args) => deps.capabilityApplyService.apply(...args),
        readRules: (...args) => deps.capabilityPermissions.readRules(...args),
        writeRules: (...args) => deps.capabilityPermissions.writeRules(...args),
      }),
    )
    .route('/rpc/mcp', createMcpRoutes(deps.mcpService))
    .route('/rpc/plugins', createPluginRoutes(deps.pluginService))
    .route('/rpc/mini-apps', createMiniAppRoutes(deps.miniAppService))
    .route('/rpc/agents', createAgentsRoutes(deps.agentsService))
    .route('/rpc/external-agents', createAgentSessionsRoutes(deps.externalAgents))
    .route('/rpc/external-agents', ownedAgentRoutes(deps))
    .route('/rpc/skills/curator', createSkillsCuratorRoutes(deps.skillsCuratorService))
    .route('/rpc/notifications', createNotificationRoutes(deps.notifications))
    .route(MEDIA_SERVE_PREFIX, createMediaRoutes(deps.mediaStore))
    .route('/rpc/system', createSystemRoutes(deps.systemService))
    .route('/rpc/storage', createStorageRoutes(deps.storageService))
    .route('/rpc/mods', createModRoutes(deps.modsHost ?? createModsHost(INERT_MOD_PORTS)))
    .route('/rpc/shell-command', createShellCommandRoutes(deps.shellCommandService))
    // Extension-owned routes are mounted through the generic subsystem registry below.
    .route('/rpc/secrets', createSecretsRoutes(deps.secretsService))
    .route(
      '/rpc/resource-refs',
      createResourceRefRoutes(deps.resourceRefsRegistry, {
        // The same ownership gate the plugin route scope uses (`resolveSessionCwd`).
        assertSessionAccess: async (...args) => {
          await deps.chatService.resolveSessionCwd(...args)
        },
      }),
    )
    .route('/rpc/search', createSearchRoutes(deps.searchService))
    .route('/rpc/semantic', createSemanticRoutes(deps.semanticService))
    .route('/rpc/local-models', createLocalModelsRoutes(deps.localModelsService))
    .route(
      '/rpc/ui-locations',
      createUiLocationCatalogRoutes(deps.uiLocationCatalogService, {
        assertProjectAccess: async (...args) => {
          await deps.projectsService.getProject(...args)
        },
      }),
    )
    .route(WEBHOOK_MOUNT_PATH, createWebhookRoutes(deps.chatService))
    .route('/rpc/terminal', createTerminalRoutes(deps.terminalService, deps.work))
    .route('/rpc/preview', createPreviewRoutes({ openPreview: deps.openPreview }))
    .route('/rpc', createConversationRoutes(deps))
    // Per-terminal PTY I/O stream — shares Bun's single websocket handler.
    .get(
      '/rpc/terminal/:id/stream',
      createTerminalStreamRoute({ service: deps.terminalService, logger: deps.logger }),
    )
    // Single multiplexed WebSocket — all live server→client events (chat firehose,
    // notifications, plugin streams) on ONE connection per tab. See features/realtime/ws.ts.
    .get(
      '/rpc/ws',
      createRealtimeRoute({
        subscribeScoped: (...args) => deps.chatService.streamRegistry.subscribeScoped(...args),
        // Optional-chained: lightweight harnesses build the app without the journal.
        notificationsSubscribe: (...args) => deps.notifications?.subscribe(...args) ?? (() => {}),
        sendMessage: (...args) => deps.chatService.sendMessage(...args),
        stop: (...args) => deps.chatService.stop(...args),
        onWatch: (clientId, sessionIds, attached) => {
          for (const sessionId of sessionIds)
            void clientEvent(deps.modsHost, { sessionId, clientId, attached })
        },
        // `interact`'s LAST parameter is `callerUserId` — the cross-tenant ownership
        // gate (`isInteractAllowedForOwner`: an ABSENT caller means "trusted internal
        // caller", so it allows everything). This binding used to name three
        // parameters against a four-parameter method, which silently discarded the
        // socket's authenticated user that ws.ts takes care to pass — leaving every
        // HITL respond/dismiss over the websocket ungated. Forward opaquely.
        interact: (...args) => deps.chatService.interact(...args),
        // The `request_secret` answer leg — same opaque forwarding (the socket's
        // authenticated user rides as the last parameter, `callerUserId`).
        submitSecret: (...args) => deps.chatService.submitSecret(...args),
        previewResult: (...args) => deps.chatService.resolvePreviewCommand(...args),
        miniAppCommandResult: (...args) => deps.chatService.resolvePluginCommand(...args),
        revokeSessionPermission: (...args) => deps.chatService.revokeSessionPermission(...args),
        // Generic registry-driven live streams (backend subsystems / bundled plugins).
        // ws.ts consults it for unrecognized subscribe/unsubscribe commands.
        wsFrames: deps.wsFrameRegistry,
        // The service IS the port (`RealtimeLspService` is a `Pick` of it), so it is
        // passed straight through. It used to be re-bound here method by method —
        // twenty arrows that restated the service's signatures and therefore could
        // drift from them. One had: `codeAction` re-typed four parameters wide
        // against a five-parameter method and silently dropped `kinds`, so an
        // "Organize imports" request over the socket came back as quick-fixes.
        // TypeScript cannot catch that (a 4-param function is assignable to a
        // 5-param signature), so the binding is gone rather than corrected.
        lsp: deps.lspDocumentService,
        completeInputs: (userId, payload, signal) =>
          deps.inlineCompletionService.completeDetailed(
            userId,
            // `references` is the client's working set (its open tabs). It used to be dropped
            // right here, while the client still computed it and keyed its cache on it.
            {
              sessionId: payload.sessionId,
              surfaces: payload.surfaces,
              ...(payload.references ? { references: payload.references } : {}),
            },
            signal,
          ),
        predictNextEdit: (userId, payload, signal) =>
          deps.nextEditService
            .predictDetailed(
              userId,
              {
                sessionId: payload.sessionId,
                requestId: payload.requestId,
                filepath: payload.file,
                content: payload.content,
                documentVersion: payload.documentVersion,
                documentDigest: payload.documentDigest,
                contextFingerprint: payload.contextFingerprint,
                cursorLine: payload.cursorLine,
                cursorColumn: payload.cursorColumn,
                language: payload.language,
                recentlyEditedRanges: payload.recentlyEditedRanges,
                contextReferences: payload.contextReferences,
              },
              signal,
            )
            .then(({ outcome, edits }) => ({
              protocolVersion: 2 as const,
              requestId: payload.requestId,
              documentVersion: payload.documentVersion,
              documentDigest: payload.documentDigest,
              contextFingerprint: payload.contextFingerprint,
              outcome,
              edits,
            })),
        logger: deps.logger,
      }),
    )
    .route('/rpc', createChatRoutes(deps.chatService))

  // Visual-feedback probe for EXTERNAL dev servers (which we don't serve, so we
  // can't inject inline). The agent adds `<script src=".../vf/probe.js">` to its
  // own dev server; the probe then talks to this UI via postMessage like the
  // auto-served (inline-injected) case. Static previews don't use this route.
  routes.get('/vf/probe.js', async (c) => {
    try {
      const js = await getPreviewProbeJs()
      return c.body(js, 200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
    } catch {
      return c.body('/* visual-feedback probe failed to build */', 200, {
        'content-type': 'application/javascript; charset=utf-8',
      })
    }
  })
  routes.get('/vf/native-probe.js', async (c) => {
    try {
      return c.body(await getNativeBrowserProbeJs(), 200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
    } catch {
      return c.text('Native browser probe unavailable', 503)
    }
  })

  if (deps.uiDir) {
    const uiRoot = resolve(deps.uiDir)
    // Fail loud at startup: a missing index.html means the SPA can't be served
    // and the browser shows a blank black screen with no obvious cause.
    if (!existsSync(join(uiRoot, 'index.html'))) {
      deps.logger.error({
        event: 'ui.dir.missing_index',
        uiDir: uiRoot,
        hint: 'Build the UI first: `cd apps/ui && bun run build` (or build the desktop app: `bun run build:desktop`).',
      })
    }
    routes.use('*', createUiStaticHandler(uiRoot))
  }

  routes.notFound((c) => jsonError(c, 404, 'not_found', 'Route not found'))
  routes.onError(createRootErrorHandler(deps.logger))

  return routes
}

export type App = ReturnType<typeof createApp>

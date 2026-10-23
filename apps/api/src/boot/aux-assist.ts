/**
 * Composition-root helper for edit prediction and the shared inline-completion
 * route used by code prediction plus every text-input completion surface —
 *
 *   - edit prediction  (the single most likely next edit, predicted)
 *   - text completion  (chat and commit-message ghost text in one request)
 *
 * Both workloads are OFF by default and share one `inlineCompletion`
 * provider/model/reasoning assignment.
 */
import type { Kysely } from 'kysely'
import type { LanguageModelFactory } from '@localixai/agent/runtime'
import type { PluginTextInputCompletionSurface } from '@localixai/mini-app-sdk/backend'
import type { AppDatabase } from '../db/types'
import { createAuxProviderHelpers } from '../features/chat/service/aux-provider'
import { createEditPredictionEngine } from '../features/edit-prediction/engine'
import { createNextEditTelemetry } from '../features/autocomplete/predict-next-edit-telemetry'
import { createEditPredictionCache } from '../features/edit-prediction/cache/memory'
import { createInlineCompletionService } from '../features/suggest/service'
import { createInlineCompletionContextResolver } from '../features/suggest/context-resolvers'
import { recordAuxCallUsage } from '../features/chat/runtime/usage-normalize'
import { envFlag } from '../lib/env'
import type { createUsageRepository } from '../features/usage/repository'
import type { createCatalogService } from '../features/catalog/service'
import type { createProviderConnectionsService } from '../features/provider-connections/service'
import type { createContextManager } from '../features/context-fabric/manager'
import {
  resolveContextWorkspace,
  type SessionWorkspacePorts,
} from '../features/context-fabric/session-workspace'
import type { createChatService } from '../features/chat/service'
import type { createUserService } from '../features/user/service'
import { createUserProfileRepository } from '../features/user/repository'
import type { createProjectsService } from '../features/projects/service'

export interface AuxAssistDeps {
  db: Kysely<AppDatabase>
  catalogService: ReturnType<typeof createCatalogService>
  providerConnectionsService: ReturnType<typeof createProviderConnectionsService>
  languageModelFactory: LanguageModelFactory
  contextManager: ReturnType<typeof createContextManager>
  chatService: ReturnType<typeof createChatService>
  userService: ReturnType<typeof createUserService>
  projectsService: ReturnType<typeof createProjectsService>
  /** Plugin-contributed text-input completion surfaces, resolved per call. */
  contributedCompletionSurface: (id: string) => PluginTextInputCompletionSurface | undefined
  /** Shared aux ledger — every aux call accumulates onto one row per (session, kind). */
  auxUsageRepo: ReturnType<typeof createUsageRepository>
}

type AgentRouteReader = Pick<ReturnType<typeof createChatService>, 'getSessionAgentRoute'>

/** Keep per-keystroke auxiliary model resolution off full session/transcript hydration. */
export async function readAuxAgentRoute(
  chatService: AgentRouteReader,
  userId: string,
  sessionId: string,
) {
  return chatService.getSessionAgentRoute(userId, sessionId).catch(() => null)
}

export function createAuxAssistServices(deps: AuxAssistDeps) {
  const { db, catalogService, providerConnectionsService, languageModelFactory } = deps
  const {
    contextManager,
    chatService,
    userService,
    projectsService,
    contributedCompletionSurface,
    auxUsageRepo,
  } = deps

  // Shared provider helpers; each surface resolves its own model-drawer route.
  const aux = createAuxProviderHelpers({
    userProfileRepo: createUserProfileRepository(db),
    catalogService,
    providerConnectionsService,
    languageModelFactory,
  })

  /** The session's provider/model/effort — the fallback for unassigned workload routes. */
  const getSessionModel = (userId: string, sessionId: string) =>
    readAuxAgentRoute(chatService, userId, sessionId)
  const workspacePorts: SessionWorkspacePorts = {
    resolveSessionWorkspaceMetadata: (...args) =>
      chatService.resolveSessionWorkspaceMetadata(...args),
    getProfile: (ownerId) => userService.getProfile(ownerId),
    getProject: (ownerId, projectId) => projectsService.getProject(ownerId, projectId),
  }
  const shared = {
    readAgentSettings: aux.readAgentSettings,
    buildLanguageModel: aux.buildLanguageModel,
    getSessionModel,
  }

  // Edit prediction — proposes the SINGLE most-likely next line-range edit in the
  // OPEN file, shown as an inline mini-diff (Tab jump/accept). Spend records under
  // the 'autocomplete' usage kind.
  const nextEditService = createEditPredictionEngine({
    ...shared,
    contextManager,
    // L1 backend result cache + single-flight: identical fingerprints skip the
    // billable model call; concurrent identical requests share one compute.
    resultCache: createEditPredictionCache(),
    // The server resolves the session's effective root
    // override). Client-provided file paths/references never define containment.
    resolveContextWorkspace: (userId, sessionId) =>
      resolveContextWorkspace(workspacePorts, userId, sessionId),
    recordUsage: (e) =>
      recordAuxCallUsage({
        usageRepo: auxUsageRepo,
        kind: 'autocomplete',
        ...e,
        onRecorded: () => chatService.refreshSessionUsage(e.userId, e.sessionId),
      }),
    recordOutcome: createNextEditTelemetry(envFlag('LOCALIX_EDIT_PREDICTION_TELEMETRY')),
  })

  // Unified text-input completion — ONE aux call serving every currently active
  // surface. Each adapter resolves its own domain context on the server; the
  // model route/reasoning/cache/transport stay shared.
  const inlineCompletionService = createInlineCompletionService({
    ...shared,
    contributedSurface: contributedCompletionSurface,
    // The shared working set resolves through the same Fabric and workspace as edit prediction.
    contextManager,
    resolveContextWorkspace: (userId, sessionId) =>
      resolveContextWorkspace(workspacePorts, userId, sessionId),
    resolveContext: createInlineCompletionContextResolver({
      chatService,
      // A contributed surface gathers its own grounding; core only forwards the caller's payload,
      // the abort signal and the deadline it is already enforcing.
      contributedContext: (id, request) =>
        contributedCompletionSurface(id)?.resolveContext(request),
    }),
    recordUsage: (e) =>
      recordAuxCallUsage({
        usageRepo: auxUsageRepo,
        kind: 'inline-completion',
        ...e,
        onRecorded: () => chatService.refreshSessionUsage(e.userId, e.sessionId),
      }),
  })

  return { aux, nextEditService, inlineCompletionService }
}

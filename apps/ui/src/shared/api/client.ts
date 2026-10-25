// The backend client. Each resource group lives in its own module (`./client/*`, `./*-client`);
// this file composes them into the one `backendClient` object every caller imports.
//
// Realtime transport (single multiplexed WebSocket) is used by the modules for the requests
// that ride it (send, HITL, secrets). Base infra (client/unwrap/API_BASE_URL/ApiError) lives
// in ./internal, so eventSocket imports from there — no client↔socket cycle.
import { lspApi } from './lspClient'
import { usageApi } from './usage-client'
import { projectsApi } from './projects-client'
import { plansApi } from './plans-client'
import { resumeApi } from './resume-client'
import { attentionApi } from './attention-client'
import { userApi } from './user-client'

import type { CatalogResponse, UiSession } from './contracts'

export { applyStreamEventToSession, needsSessionResync } from './applyStreamEvent'
import { client, unwrap, ApiError, apiFetch, API_BASE_URL, WS_BASE_URL } from './internal'
import { providerConnectionsApi } from './providers-client'
import { pluginsApi } from './plugins-client'
import { miniAppsApi } from './mini-apps-client'
import { capabilitiesApi } from './capabilities-client'
import { toolsApi } from './tools-client'
import { skillsApi } from './skills-client'
import { systemApi } from './system-client'
import { agentsApi } from './agents-client'
import { filesApi } from './files-client'
import { editorAssistApi } from './editor-assist-client'
import { sessionsApi } from './client/sessions'
import { messagesApi } from './client/messages'
import { realtimeApi } from './client/realtime'
import { terminalsApi } from './client/terminals'
import { runsApi } from './client/runs'

// Re-exported so existing `from './client'` import sites keep working.
export { ApiError, apiFetch, API_BASE_URL, WS_BASE_URL }
export { toImportSessionRequest, type ImportSessionClientInput } from './client/sessions'
export type { SendMessageResult } from './client/messages'
export type { OpenedPreview, ResolvedPreviewEndpoint } from './client/terminals'

export interface WorkspaceSnapshot {
  sessions: UiSession[]
  activeSessionId: string | null
}

export function createWorkspaceSnapshot(
  sessions: UiSession[],
  activeSessionId: string | null,
): WorkspaceSnapshot {
  return { sessions, activeSessionId }
}

export const backendClient = {
  async getCatalog(): Promise<CatalogResponse> {
    return unwrap(await client.rpc.models.catalog.$get())
  },

  /** Fetch newer model lists now, past the server's freshness window. */
  async refreshModelCatalog() {
    return unwrap(await client.rpc.models.catalog.refresh.$post())
  },

  ...providerConnectionsApi,
  ...sessionsApi,

  ...skillsApi,

  ...pluginsApi,
  ...miniAppsApi,
  ...capabilitiesApi,
  ...toolsApi,
  ...systemApi,
  ...agentsApi,

  ...usageApi,

  ...filesApi,

  ...messagesApi,
  ...realtimeApi,
  ...terminalsApi,

  // The `lsp.*` editor ↔ language-server surface lives in ./lspClient.
  ...lspApi,

  ...editorAssistApi,

  ...runsApi,

  // Live session events arrive over the shared realtime WebSocket — see
  // shared/api/eventSocket.ts (subscribed by entities/chat/model/agent-runtime.ts).

  ...projectsApi,
  ...plansApi,
  ...resumeApi,
  ...attentionApi,

  ...userApi,
}

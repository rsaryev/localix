import type { ReasoningEffort } from '@localixai/agent'
import type { PermissionMode } from '@localixai/api/permission-modes'
// Realtime transport (single multiplexed WebSocket). Imported for the requests
// that ride it (send, HITL, secrets). Base infra (client/unwrap/API_BASE_URL/ApiError)
// lives in ./internal, so eventSocket imports from there — no client↔socket cycle.
import { eventSocket } from './eventSocket'
import { lspApi } from './lspClient'
import { usageApi } from './usage-client'
import { projectsApi } from './projects-client'
import { questionsApi } from './questions-client'
import { plansApi } from './plans-client'
import { resumeApi } from './resume-client'
import { attentionApi } from './attention-client'
import { userApi } from './user-client'

import type {
  CatalogResponse,
  Message,
  ResourceBrowseResult,
  ProviderConnection,
  SessionBranchTree,
  HistorySearchHit,
  UiSession,
  MessageBinding,
  MessageMutationResponse,
  QueueClearResult,
  QueuePromoteResult,
  QueueRemovalResult,
} from './contracts'

import { toUiSession, toUiSessionSummary } from './converters'
export { applyStreamEventToSession, needsSessionResync } from './applyStreamEvent'
import { client, unwrap, ApiError, apiFetch, API_BASE_URL, WS_BASE_URL, assertOk } from './internal'
import { providerConnectionsApi } from './providers-client'
import { mcpApi } from './mcp-client'
import { pluginsApi } from './plugins-client'
import { capabilitiesApi } from './capabilities-client'
import { toolsApi } from './tools-client'
import { skillsApi } from './skills-client'
import { systemApi } from './system-client'
import { agentsApi } from './agents-client'
import { filesApi } from './files-client'
import { editorAssistApi } from './editor-assist-client'
import {
  readyWorkbenchToolSurface,
  readyWorkbenchToolSurfaceForProject,
} from '@/shared/contrib/uiLocationCatalogSync'
import { agentRunPreflight } from './agentRunPreflight'

// Re-exported so existing `from './client'` import sites keep working.
export { ApiError, apiFetch, API_BASE_URL, WS_BASE_URL }

export interface WorkspaceSnapshot {
  connections: ProviderConnection[]
  sessions: UiSession[]
  activeSessionId: string | null
}

/** What `POST /rpc/preview/open` answers — the same facts the `preview.updated` frame carries. */
export interface OpenedPreview {
  url: string
  previewId: string
  title: string
  version: number
  servedFile?: string
  rootDir?: string
  frameBlocked: boolean
}

/** What `POST /rpc/preview/resolve` answers: where the page is served from RIGHT NOW. */
export interface ResolvedPreviewEndpoint {
  url: string
  previewId: string
  /** Probe-injecting proxy in front of an external server, bound by the live API process. */
  injectUrl?: string
}

export interface ImportSessionClientInput {
  title: string
  messages: readonly {
    role: Extract<Message['role'], 'user' | 'assistant'>
    content?: string
    items?: Message['items']
  }[]
  projectId?: string | null
}

/**
 * The import route is strict on purpose. A UI `Message` also carries its local row id and
 * presentation-only state, so passing one through structurally makes every `messages.*.id` an
 * unrecognized key. Rebuild the wire body field by field at the client boundary.
 */
export function toImportSessionRequest(input: ImportSessionClientInput): ImportSessionClientInput {
  return {
    title: input.title,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    messages: input.messages.map((message) => ({
      role: message.role,
      ...(message.content === undefined ? {} : { content: message.content }),
      ...(message.items === undefined ? {} : { items: message.items }),
    })),
  }
}

/** Keep the realtime send response tied to the HTTP/API owner contract, including
 * the `queued` acceptance signal used to reconcile optimistic placeholders. */
export type SendMessageResult = MessageMutationResponse

export function createWorkspaceSnapshot(
  sessions: UiSession[],
  connections: ProviderConnection[],
  activeSessionId: string | null,
): WorkspaceSnapshot {
  return { sessions, connections, activeSessionId }
}

async function readyAgentRunToolSurface(projectId?: string | null) {
  const policy = agentRunPreflight(projectId)
  const surface =
    projectId === undefined
      ? readyWorkbenchToolSurface()
      : readyWorkbenchToolSurfaceForProject(projectId)
  if (!policy) return surface
  const [, readySurface] = await Promise.all([policy, surface])
  return readySurface
}

export const backendClient = {
  async getCatalog(): Promise<CatalogResponse> {
    return unwrap(await client.rpc.models.catalog.$get())
  },

  ...providerConnectionsApi,

  async listSessions(signal?: AbortSignal): Promise<UiSession[]> {
    const json = await unwrap(await client.rpc.sessions.$get(undefined, { init: { signal } }))
    return json.sessions.map(toUiSessionSummary)
  },

  /** Cross-conversation message search (FTS5). Returns ranked hits with `[..]`-
   *  highlighted snippets; empty/unindexed degrades to []. */
  async searchHistory(q: string, limit?: number): Promise<HistorySearchHit[]> {
    const query = limit ? { q, limit: String(limit) } : { q }
    const json = await unwrap(await client.rpc['history-search'].$get({ query }))
    return json.hits
  },

  ...skillsApi,

  ...mcpApi,
  ...pluginsApi,
  ...capabilitiesApi,
  ...toolsApi,
  ...systemApi,
  ...agentsApi,

  ...usageApi,

  async getSession(id: string, signal?: AbortSignal): Promise<UiSession> {
    const json = await unwrap(
      // The web UI loads the full message list, but collapsed tool cards resolve
      // their heavy details only when opened. The query is OPT-IN: a client that
      // needs every detail up front simply omits it.
      await client.rpc.sessions[':id'].$get(
        { param: { id }, query: { toolDetails: 'deferred' } },
        { init: { signal } },
      ),
    )
    return toUiSession(json)
  },

  ...filesApi,

  async createSession(input?: {
    title?: string
    providerConnectionId?: string | null
    modelId?: string
    reasoningEffort?: ReasoningEffort
    projectId?: string | null
    /**
     * Who the chat is with, in join order — which is also the order they speak in. Absent = the
     * default agent, which is what "new chat" means; two or more makes it a group.
     */
    agentIds?: string[]
  }): Promise<UiSession> {
    const json = await unwrap(await client.rpc.sessions.$post({ json: input ?? {} }))
    return toUiSession(json)
  },

  /**
   * Import a conversation from outside Localix as a real session.
   *
   * The body is our OWN message model — the caller has already shaped its source into it. Nothing
   * about where the conversation came from is expressed here, which is what lets the next importer
   * reuse this unchanged.
   */
  async importSession(input: ImportSessionClientInput): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions.import.$post({ json: toImportSessionRequest(input) as never }),
    )
    return toUiSession(json)
  },

  async updateSession(
    id: string,
    patch: {
      title?: string
      /**
       * Re-route ONE participant. `handle` names whom the choice is for; omitted means the
       * session's own participant, which is unambiguous in a private chat and is the first
       * member in a group.
       */
      route?: {
        agentId?: string
        providerConnectionId?: string | null
        modelId?: string
        reasoningEffort?: ReasoningEffort
      }
      /** Replace the participants — add or remove. Whole list, never a diff. */
      agentIds?: string[]
      /** The session revision `agentIds` was built from; a newer one refuses the list (409). */
      expectedUpdatedAt?: string
      /** Fix the participants before the conversation starts; afterwards the server says 409. */
      rosterLocked?: boolean
      /** The conversation's permission mode; a delegated child refuses it (409). */
      permissionMode?: PermissionMode
      isPinned?: boolean
      isArchived?: boolean
      projectId?: string | null
      runtimeStatus?: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
    },
  ): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].$patch({
        param: { id },
        json: patch,
      }),
    )
    return toUiSession(json)
  },

  async deleteSession(id: string): Promise<void> {
    const response = await client.rpc.sessions[':id'].$delete({ param: { id } })
    await assertOk(response)
  },

  // Rides the shared realtime WebSocket (see eventSocket) so a send never competes
  // for one of the browser's scarce HTTP connection slots while streams are open.
  async sendMessage(
    sessionId: string,
    prompt: string,
    bindings?: MessageBinding[],
    /** Hide the user turn in the transcript (the model still sees it) — for machine-composed
     *  prompts the user triggered but did not type (e.g. the chart's analysis wizard). */
    isInternal?: boolean,
    /** Optimistic user-row identity for exact server-queue reconciliation. */
    clientMessageId?: string,
    /** Owning session scope. A warm/plugin surface can send outside the active
     * route, so its run must never inherit another project's UI catalog. */
    projectId?: string | null,
  ): Promise<SendMessageResult> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return eventSocket.request<SendMessageResult>({
      t: 'send',
      sessionId,
      prompt,
      toolSurface,
      ...(bindings && bindings.length > 0 ? { bindings } : {}),
      ...(isInternal ? { isInternal: true } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
    })
  },

  /**
   * Regenerate the latest reply. `expectedMessageId` names the reply the caller means (a Retry
   * from a failure row); the server refuses with 409 `regenerate_superseded` / `regenerate_no_reply`
   * when it is not the latest, instead of rewriting whatever reply came after it.
   */
  async regenerate(
    sessionId: string,
    projectId?: string | null,
    expectedMessageId?: string,
  ): Promise<SendMessageResult> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return unwrap(
      await client.rpc.sessions[':id'].regenerate.$post({
        param: { id: sessionId },
        json: { toolSurface, ...(expectedMessageId ? { expectedMessageId } : {}) },
      }),
    )
  },

  async rollback(sessionId: string, messageId: string): Promise<{ restoredPrompt: string }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].rollback.$post({
        param: { id: sessionId, messageId },
      }),
    )
  },

  /**
   * Toggle your own mark on a message. The server answers whether it is now on, but the chip
   * does not wait for that: the updated message arrives on the stream like any other change,
   * so both the person's marks and an agent's reach every open client the same way.
   */
  async reactToMessage(
    sessionId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: true; reacted: boolean }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].reactions.$post({
        param: { id: sessionId, messageId },
        json: { emoji },
      }),
    )
  },

  /**
   * Keep a message in the agent's view across context checkpoints, or stop keeping it. Like a
   * reaction, the pinned mark arrives on the stream as the updated message.
   */
  async pinMessage(
    sessionId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<{ ok: true; pinned: boolean }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].pin.$post({
        param: { id: sessionId, messageId },
        json: { pinned },
      }),
    )
  },

  async switchBranch(
    sessionId: string,
    messageId: string,
    branchIndex: number,
  ): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].messages[':messageId']['switch-branch'].$post({
        param: { id: sessionId, messageId },
        json: { branchIndex },
      }),
    )
    return toUiSession(json)
  },

  /** Full message tree (all branches) + active path for the branch-tree panel. */
  async getBranchTree(sessionId: string): Promise<SessionBranchTree> {
    return unwrap(
      await client.rpc.sessions[':id'].branches.$get({
        param: { id: sessionId },
      }),
    )
  },

  /** Jump the active branch to any message in the tree (leaf moves to its deepest descendant). */
  async checkoutBranch(sessionId: string, messageId: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].branches.checkout.$post({
        param: { id: sessionId },
        json: { messageId },
      }),
    )
    return toUiSession(json)
  },

  /** Fork the conversation into a NEW session (history up to messageId, or the current leaf). */
  async forkSession(sessionId: string, messageId?: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].fork.$post({
        param: { id: sessionId },
        json: messageId ? { messageId } : {},
      }),
    )
    return toUiSession(json)
  },

  /** Open (or reopen) the side-conversation thread anchored to an assistant message. */
  async openMessageThread(sessionId: string, messageId: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].thread.$post({
        param: { id: sessionId, messageId },
      }),
    )
    return toUiSession(json)
  },

  /** Edit a past user message → forks a new branch and re-runs from there. */
  async editMessage(
    sessionId: string,
    messageId: string,
    content: string,
    projectId?: string | null,
  ): Promise<{ sessionId: string; messageId: string }> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].edit.$post({
        param: { id: sessionId, messageId },
        json: { content, toolSurface },
      }),
    )
  },

  // HITL responses / tool kills over the shared realtime WebSocket (see eventSocket).
  async interact(toolCallId: string, action: string, payload?: unknown): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'interact', toolCallId, action, payload })
  },

  // The request_secret VALUE side-channel: a dedicated `submit-secret` frame,
  // deliberately NOT `interact` — the plaintext goes straight to the server's
  // encrypted vault and never touches the ask/quiz respond path (whose payloads
  // land in the HITL controller's answer record). The reply is `{ok}` only.
  async submitSecret(requestId: string, value: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'submit-secret', requestId, value })
  },

  // Revoke a session's "Always allow" grant (drop one tool, or all when toolName is
  // omitted) so it re-prompts on its next call. The server publishes
  // session_permissions.updated, so the chip refreshes from the firehose.
  async revokeSessionPermission(sessionId: string, toolName?: string): Promise<string[]> {
    const res = await eventSocket.request<{ autoApprovedTools: string[] }>({
      t: 'session.revoke-permission',
      sessionId,
      ...(toolName ? { toolName } : {}),
    })
    return res.autoApprovedTools ?? []
  },

  // Reply to an agent `browser` tool command after the open preview's probe ran
  // it — settles the server-side pending promise (preview-command-registry).
  async previewResult(commandId: string, payload: Record<string, unknown>): Promise<boolean> {
    const result = await eventSocket.request<{ resolved: boolean }>({
      t: 'preview-result',
      commandId,
      ...payload,
    })
    return result.resolved
  },

  // Reply to an awaited `plugin.command` frame after the plugin's UI sink handled
  // it — settles the server-side pending promise (plugin-command-registry).
  async pluginCommandResult(
    commandId: string,
    payload: { ok: boolean; result?: unknown; error?: string },
  ): Promise<void> {
    await eventSocket.request<{ resolved: boolean }>({
      t: 'plugin-command-result',
      commandId,
      ...payload,
    })
  },

  // Run a command in a PTY pane for a session's workspace (e.g. the preview panel
  // relaunching a stopped dev server). Returns the backend terminalId so the UI can
  // adopt the pane and surface its logs on demand.
  async spawnTerminalCommand(input: {
    sessionId: string
    command: string
  }): Promise<{ terminalId: string }> {
    return unwrap(await client.rpc.terminal.spawn.$post({ json: input }))
  },

  // Where a preview's page is served from NOW. Both in-process preview servers (the static
  // file server, the probe-injecting proxy) live on ephemeral ports that die with the API
  // process, so the pane asks before every mount and after every reconnect instead of
  // trusting a stored port — which is what left a white frame over a live app.
  async resolvePreview(input: {
    url: string
    rootDir?: string
    servedFile?: string
  }): Promise<ResolvedPreviewEndpoint> {
    return unwrap(await client.rpc.preview.resolve.$post({ json: input }))
  },

  // Kill a PTY by id (e.g. stopping a dev server the Preview panel launched).
  async closeTerminal(terminalId: string): Promise<void> {
    await client.rpc.terminal[':id'].$delete({ param: { id: terminalId } })
  },

  // The session's MANAGED JOBS — the single source of truth for long-running
  // spawned processes. Both an agent `bash background` job and a preview "Start
  // server" relaunch spawn a command-bearing PTY via terminalService, so a live
  // PTY that carries a `command` (interactive shells have none) IS a job. Returns
  // them with the cwd they run in, so the UI can show + stop + (later) relaunch.
  // ALL of the session's live PTYs — command-bearing background jobs AND
  // interactive shells — with their server-side liveness signals (alt-screen =
  // a full-screen TUI is running). Callers filter: the jobs strip shows the
  // command-bearing rows, the auto-reveal policy watches every row.
  async listSessionTerminals(sessionId: string): Promise<
    Array<{
      terminalId: string
      command?: string
      cwd: string
      previewUrl?: string
      altScreen: boolean
    }>
  > {
    const rows = await unwrap(await client.rpc.terminal.$get())
    return rows.flatMap((r) =>
      r.chatSessionId === sessionId
        ? [
            {
              terminalId: r.id,
              command: r.command,
              cwd: r.cwd,
              previewUrl: r.previewUrl,
              altScreen: r.altScreen ?? false,
            },
          ]
        : [],
    )
  },

  // Backend-authoritative `@resource:` browse. The server owns URI navigation,
  // provider grouping, search, sorting, notices and the shared cap.
  async browseResources(partial: string, sessionId?: string): Promise<ResourceBrowseResult> {
    return unwrap(
      await client.rpc['resource-refs'].$get({
        query: { partial, ...(sessionId ? { sessionId } : {}) },
      }),
    )
  },

  // Open (or reload) a live preview for a URL a background job advertised — used by
  // the jobs strip's "Open preview" so a closed preview can be re-attached. The
  // server publishes `preview.updated`, which the UI routes to reveal the tab.
  async openPreview(sessionId: string, url: string, root?: string): Promise<OpenedPreview> {
    // Unwrapped, not fired-and-forgotten: the server refuses a preview for real reasons (no such
    // file, a path outside the workspace, a dead URL), and a caller that never read the response
    // showed "Previewing…" over nothing.
    return unwrap(
      await client.rpc.preview.open.$post({ json: { sessionId, url, ...(root ? { root } : {}) } }),
    )
  },

  // The `lsp.*` editor ↔ language-server surface lives in ./lspClient.
  ...lspApi,

  ...editorAssistApi,

  async stop(sessionId: string): Promise<boolean> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].stop.$post({
        param: { id: sessionId },
      }),
    )
    return json.stopped
  },

  /** Stop one of a session's monitors. False when it is already ended or not the user's. */
  async stopSessionMonitor(sessionId: string, monitorId: string): Promise<boolean> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].monitors.stop.$post({
        param: { id: sessionId },
        json: { monitorId },
      }),
    )
    return json.stopped
  },

  /** Cancel a session loop by id. Returns true if the loop existed and was removed. */
  async cancelSessionLoop(loopId: string): Promise<boolean> {
    const json = await unwrap(await client.rpc.loops.cancel.$post({ json: { id: loopId } }))
    return json.removed
  },

  /** Fire a session loop now (extra occurrence). Returns true if it existed and fired. */
  async runSessionLoop(loopId: string): Promise<boolean> {
    const policy = agentRunPreflight(undefined)
    if (policy) await policy
    const json = await unwrap(await client.rpc.loops.run.$post({ json: { id: loopId } }))
    return json.fired
  },

  /** Atomically cancel one queued message; content is returned only when cancellation wins. */
  async removeQueuedMessage(sessionId: string, itemId: string): Promise<QueueRemovalResult> {
    return unwrap(
      await client.rpc.sessions[':id'].queue.remove.$post({
        param: { id: sessionId },
        json: { itemId },
      }),
    )
  },

  /** Atomically stop the active run and deliver one selected backend queue row. */
  async interruptAndPromoteQueuedMessage(
    sessionId: string,
    itemId: string,
  ): Promise<QueuePromoteResult> {
    return unwrap(
      await client.rpc.sessions[':id'].queue['send-now'].$post({
        param: { id: sessionId },
        json: { itemId },
      }),
    )
  },

  /** Clear every cancellable queue entry and report rows already leased for delivery. */
  async clearQueuedMessages(sessionId: string): Promise<QueueClearResult> {
    return unwrap(await client.rpc.sessions[':id'].queue.clear.$post({ param: { id: sessionId } }))
  },

  // Live session events arrive over the shared realtime WebSocket — see
  // shared/api/eventSocket.ts (subscribed by features/chat/model/agent-runtime.ts).

  ...projectsApi,
  ...questionsApi,
  ...plansApi,
  ...resumeApi,
  ...attentionApi,

  ...userApi,
}

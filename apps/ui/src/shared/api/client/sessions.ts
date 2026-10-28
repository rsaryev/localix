import type { ReasoningEffort } from '@localixai/agent'
import type { PermissionMode } from '@localixai/api/permission-modes'
import type { HistorySearchHit, Message, UiSession } from '../contracts'
import { toUiSession, toUiSessionSummary } from '../converters'
import { client, unwrap, assertOk } from '../internal'

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

/** Session listing, lookup and lifecycle (create, import, update, delete). */
export const sessionsApi = {
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

  /** What a plugin's `subagentStatusLine` last drew in this conversation's subagent rows. */
  async getSubagentRows(id: string, signal?: AbortSignal) {
    return unwrap(
      await client.rpc.sessions[':id']['subagent-rows'].$get(
        { param: { id } },
        { init: { signal } },
      ),
    )
  },

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

  async createSession(input?: {
    externalAgentProvider?: string
    title?: string
    providerConnectionId?: string | null
    modelId?: string
    reasoningEffort?: ReasoningEffort
    projectId?: string | null
    /** The registry agent the chat is with, fixed for its life. Absent = the default agent. */
    agentId?: string
    /** A landing: the server answers with the project's newest untouched chat when it has one. */
    reuseEmptyDraft?: boolean
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
      /** Re-route the conversation's agent: the model it runs on, never who it is. */
      route?: {
        providerConnectionId?: string | null
        modelId?: string
        reasoningEffort?: ReasoningEffort
      }
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
}

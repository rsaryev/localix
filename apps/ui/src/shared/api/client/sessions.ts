import type { ReasoningEffort } from '@localixai/agent'
import type { PermissionMode } from '@localixai/api/permission-modes'
import type { HistorySearchHit, JoinRoutesView, Message, UiSession } from '../contracts'
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

  /** What each agent not invited yet would join this session on (`JoinRoutesView`). */
  async getJoinRoutes(id: string, signal?: AbortSignal): Promise<JoinRoutesView> {
    return unwrap(
      await client.rpc.sessions[':id']['join-routes'].$get({ param: { id } }, { init: { signal } }),
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
      /**
       * Choose models for several agents in one write — seated, or not invited yet (the choice
       * waits for them). Each must be able to take part, or none moves.
       */
      routes?: Array<{
        agentId: string
        providerConnectionId?: string | null
        modelId?: string
        reasoningEffort?: ReasoningEffort
      }>
      /** Replace the participants — add or remove. Whole list, never a diff. */
      agentIds?: string[]
      /** The session revision `agentIds` was built from; a newer one refuses the list (409). */
      expectedUpdatedAt?: string
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

/**
 * Composition-root helpers: the DB-backed loaders behind the composer's
 * `@`-context-refs (session / terminal / call / project / message) plus
 * the chat-nav (`localix://resource/chat`) listing ports.
 *
 * They live here — not in a feature — because they cross feature boundaries on
 * purpose: the `projects` feature owns ref EXPANSION but must stay chat-agnostic,
 * so the composition root supplies these reads. Extracted out
 * of `bootstrap.ts` (Long Function) with the message-text flattening and the
 * root-chat-session filter deduped into one place each (Duplicated Code).
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import type { StoredMessagePayload } from '../db/payload'
import { createChatRepository } from '../features/chat/repository'
import { createProjectsRepository } from '../features/projects/repository'
import { buildSessionDigest, DIGEST_MAX_TURNS } from '../features/projects/session-digest'
import { buildProjectDigest } from '../features/projects/project-digest'
import { buildMessageDigest } from '../features/projects/message-digest'
import { buildCallDigest, type CallDigestInput } from '../features/projects/call-digest'
import { buildTerminalDigest } from '../features/terminal/scrollback-digest'
import { chatMessagePreview } from '../features/chat/resource-provider'
import type { createTerminalService } from '../features/terminal/service'

type TerminalService = ReturnType<typeof createTerminalService>

/**
 * A persisted message reduced to plain text: the flat `content` when present,
 * else the concatenated `text` items. The one flattener every digest/preview
 * read shares (it was copy-pasted three times in the composition root).
 */
function messageText(payload: StoredMessagePayload): string {
  if (typeof payload.content === 'string' && payload.content) return payload.content
  const items = (payload as { items?: Array<{ type?: string; text?: string } | null> }).items
  if (!Array.isArray(items)) return ''
  return items
    .filter(
      (i): i is { type: string; text: string } =>
        !!i && i.type === 'text' && typeof i.text === 'string',
    )
    .map((i) => i.text)
    .join(' ')
}

export interface DigestLoaderDeps {
  db: Kysely<AppDatabase>
  /**
   * Lazy accessor — the terminal service is constructed later in bootstrap (it
   * depends on chatService), and expansion only runs per-request.
   */
  terminalService: () => TerminalService | undefined
}

export function createDigestLoaders({ db, terminalService }: DigestLoaderDeps) {
  /** A project's root chat sessions, newest first (shared by the digest + the chat-nav tree). */
  const listRootChatSessions = async (userId: string, projectId: string) =>
    createChatRepository(db).listProjectRootChatSessions(userId, projectId)

  /** A run's final assistant reply, used by explicit child-session handoffs. */
  const finalAssistantText = async (userId: string, sessionId: string): Promise<string | null> => {
    const last = await createChatRepository(db).getLatestAutonomousAssistantContentMessage(
      userId,
      sessionId,
    )
    return last?.payload.content ?? null
  }

  /**
   * Builds the compact digest for a `@session:<id>` composer context-ref: title,
   * status, and a bounded tail of recent turns.
   */
  const loadSessionDigest = async (userId: string, sessionId: string): Promise<string | null> => {
    const repo = createChatRepository(db)
    const session = await repo.getSession(userId, sessionId)
    if (!session) return null
    const digest = await repo.getSessionDigestMessages(userId, sessionId, DIGEST_MAX_TURNS)
    const recentTurns = digest.recentPayloads.flatMap((p) => {
      if ((p.role !== 'user' && p.role !== 'assistant') || p.uiOnly) return []
      return [{ role: p.role, text: messageText(p) }]
    })
    return buildSessionDigest({
      id: session.id,
      title: session.title,
      runtimeStatus: session.runtimeStatus,
      messageCount: digest.messageCount,
      updatedAt: session.updatedAt,
      recentTurns,
    })
  }

  /**
   * Builds the digest for a `@terminal:<id>` composer context-ref: cwd, recent
   * OSC 133 commands + exit codes, and a bounded scrollback tail. Accepts the
   * full terminal id or a UNIQUE prefix (the composer inserts a short prefix to
   * keep tokens cheap).
   */
  const loadTerminalDigest = async (
    userId: string,
    terminalRef: string,
  ): Promise<string | null> => {
    const terminals = terminalService()
    if (!terminals) return null
    const matches = terminals
      .list(userId)
      .filter((t) => t.id === terminalRef || t.id.startsWith(terminalRef))
    if (matches.length !== 1) return null
    const live = terminals.get(userId, matches[0].id)
    if (!live) return null
    const info = live.info
    return buildTerminalDigest({
      id: info.id,
      cwd: info.cwd,
      command: info.command,
      altScreen: info.altScreen,
      lastOutputAt: info.lastOutputAt,
      scrollback: live.replay,
      screen: (await live.screen()).text,
    })
  }

  /**
   * Builds the digest for a `@call:<toolCallId>` composer context-ref: finds the
   * persisted tool-backed item in the SENDING session's transcript (full id or a
   * unique prefix) and reduces it to name/input/bounded result (+ error line).
   */
  const loadCallDigest = async (
    userId: string,
    sessionId: string,
    toolCallRef: string,
  ): Promise<string | null> => {
    const repo = createChatRepository(db)
    const messages = await repo.listActiveBranchToolCallMessagesByPrefix(
      userId,
      sessionId,
      toolCallRef,
    )
    const found: CallDigestInput[] = []
    for (const m of messages) {
      const items = (m.payload as { items?: unknown }).items
      if (!Array.isArray(items)) continue
      for (const item of items as Array<Record<string, unknown>>) {
        if (!item || typeof item.toolCallId !== 'string') continue
        if (item.toolCallId !== toolCallRef && !item.toolCallId.startsWith(toolCallRef)) continue
        const changes = Array.isArray(item.changes)
          ? (item.changes as Array<{ path?: unknown }>)
          : undefined
        found.push({
          sessionId,
          toolCallId: item.toolCallId,
          name: typeof item.name === 'string' ? item.name : 'tool',
          status: typeof item.status === 'string' ? item.status : 'completed',
          itemType: typeof item.type === 'string' ? item.type : 'tool_call',
          input: item.input,
          command: typeof item.command === 'string' ? item.command : undefined,
          changedPaths: changes
            ?.map((c) => (typeof c.path === 'string' ? c.path : ''))
            .filter(Boolean),
          resultText: typeof item.resultText === 'string' ? item.resultText : undefined,
          errorText: typeof item.errorText === 'string' ? item.errorText : undefined,
        })
      }
    }
    // A prefix must resolve unambiguously; the same full id twice (streaming
    // update rows) collapses to the latest occurrence.
    const unique = new Map(found.map((f) => [f.toolCallId, f]))
    if (unique.size !== 1) return null
    return buildCallDigest([...unique.values()][0])
  }

  /**
   * Builds the digest for a `@project:<id>` composer context-ref: the project's
   * name, working directory, and a bounded roster of its recent root chat sessions.
   * Introspection ONLY — never connection creds, secrets, or a git remote URL.
   */
  const loadProjectDigest = async (userId: string, projectId: string): Promise<string | null> => {
    const project = await createProjectsRepository(db).getProject(userId, projectId)
    if (!project) return null
    const sessions = await listRootChatSessions(userId, projectId)
    return buildProjectDigest({
      id: project.id,
      name: project.name,
      workingDir: project.workingDir,
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({
        title: s.title,
        runtimeStatus: s.runtimeStatus,
        updatedAt: s.updatedAt,
      })),
    })
  }

  /**
   * Builds the digest for a `@message:<sessionId>/<messageId>` composer context-ref:
   * ONE transcript message's role + capped text. Loaded fresh, so a since-deleted
   * session/message returns null → a graceful "could not expand" note.
   */
  const loadMessageDigest = async (
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<string | null> => {
    const repo = createChatRepository(db)
    // The context ref already carries the immutable message id. Keep this an
    // owner/session-scoped point read: loading the transcript makes expansion
    // latency and synchronous JSON parsing grow with the conversation.
    const msg = await repo.getMessage(userId, sessionId, messageId)
    if (!msg) return null
    return buildMessageDigest({
      sessionId,
      messageId,
      role: msg.payload.role ?? 'assistant',
      text: messageText(msg.payload),
    })
  }

  /**
   * Listing ports for the chat-nav resource provider (`localix://resource/chat` — projects →
   * sessions → messages). Reuses the same repositories + flattener as the digests.
   */
  const chatNavPorts = {
    listProjects: async (userId: string) =>
      (await createProjectsRepository(db).listProjects(userId)).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    listProjectSessions: async (userId: string, projectId: string) =>
      (await listRootChatSessions(userId, projectId)).map((s) => ({
        id: s.id,
        title: s.title,
        runtimeStatus: s.runtimeStatus,
        updatedAt: s.updatedAt,
      })),
    listRecentSessionMessages: async (userId: string, sessionId: string, limit: number) => {
      const page = await createChatRepository(db).listRecentVisibleMessages(
        userId,
        sessionId,
        limit,
      )
      return {
        messages: page.messages.map((m) => ({
          id: m.id,
          role: m.payload.role ?? 'assistant',
          preview: chatMessagePreview(m.payload.role ?? '', messageText(m.payload)),
        })),
        hasMore: page.hasMore,
      }
    },
    listSessionMessages: async (userId: string, sessionId: string) => {
      const messages = await createChatRepository(db).listMessages(userId, sessionId)
      // NOT capped here — the provider filters by the typed query FIRST, then
      // caps at CHAT_NAV_MAX_MESSAGES, so search can reach past the cap.
      return messages
        .filter(
          (m) => (m.payload.role === 'user' || m.payload.role === 'assistant') && !m.payload.uiOnly,
        )
        .reverse()
        .map((m) => ({
          id: m.id,
          role: m.payload.role ?? 'assistant',
          preview: chatMessagePreview(m.payload.role ?? '', messageText(m.payload)),
        }))
    },
  }

  return {
    finalAssistantText,
    loadSessionDigest,
    loadTerminalDigest,
    loadCallDigest,
    loadProjectDigest,
    loadMessageDigest,
    chatNavPorts,
  }
}

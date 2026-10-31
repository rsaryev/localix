/**
 * CHAT search providers — two `SearchProvider`s (agent-core search) over the existing
 * chat service:
 *   - `sessions` ("Chats")   → title match across sessions + subsessions
 *   - `messages` ("Messages")→ FTS5 over the message history (via `searchHistory`)
 *
 * Hit ids reuse the `localix://resource/chat/session/<id>` grammar the chat resource provider already
 * owns, so a result opens the session AND drops into chat as a native `@session:` ref
 * with zero extra plumbing. Narrow structural ports keep this decoupled — bootstrap
 * maps the real `chatService` in. Both are `eager` (cheap indexed reads).
 */
import type { SearchHit, SearchProvider } from '@localixai/mini-app-sdk/backend'
import { bestFieldScore } from '@localixai/mini-app-sdk/backend'
import { RESOURCE_PROVIDERS } from '../agent-core/resource-refs/providers'
import { localixResourceUri, localixUiUri } from '@localixai/mini-app-sdk/navigation'
import type { MessageSearchReads } from './repository-message-search'
import { hybridMessageHits, hybridSessionHits } from './search-provider-hybrid'

/**
 * A search hit's id IS a `localix://resource/chat` resource URI (that is what makes a result
 * openable + drag-linkable with no extra plumbing), so the scheme comes from the
 * shared vocabulary — the same import `resource-provider.ts` uses. Re-spelling the
 * literal here is exactly the drift `schemes.ts` exists to make impossible: a
 * duplicate that AGREES with its original is invisible to types and tests.
 */
const sessionUri = (sessionId: string): string =>
  localixResourceUri(RESOURCE_PROVIDERS.chat, ['session', sessionId])
const messageUri = (sessionId: string, messageId: string): string =>
  localixResourceUri(RESOURCE_PROVIDERS.chat, ['message', sessionId, messageId])

/** One session/subsession as the sessions provider reads it. */
export interface SessionSearchRow {
  id: string
  title: string
  projectId: string | null
  parentSessionId: string | null
  sessionKind: string
}

/** One FTS message hit as the messages provider reads it (shape of `HistorySearchHit`). */
export interface MessageSearchHit {
  messageId: string
  sessionId: string
  role: string
  snippet: string
  createdAt: string
}

export interface ChatSearchPort {
  listSessions(userId: string, projectId?: string | null): Promise<SessionSearchRow[]>
  searchMessages(userId: string, query: string, limit: number): Promise<MessageSearchHit[]>
  /** The reads of the hybrid strategy; without them a semantic query falls back to words. */
  hybridReads?: MessageSearchReads
}

/**
 * The sessions and messages providers run concurrently for aggregate search and
 * need the same scoped title map. Share only overlapping reads: once both have
 * settled, the next keystroke gets a fresh authoritative snapshot.
 */
export function shareOverlappingSessionSearchReads(
  load: (userId: string, projectId?: string | null) => Promise<SessionSearchRow[]>,
): ChatSearchPort['listSessions'] {
  const inFlight = new Map<string, Promise<SessionSearchRow[]>>()
  return (userId, projectId) => {
    // JSON serializes array `undefined` as null; tag the scope so an unscoped
    // search can never reuse a concurrent global-only roster.
    const scopeKey =
      projectId === undefined ? 'all' : projectId === null ? 'global' : `project:${projectId}`
    const key = JSON.stringify([userId, scopeKey])
    const existing = inFlight.get(key)
    if (existing) return existing
    const request = load(userId, projectId).finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key)
    })
    inFlight.set(key, request)
    return request
  }
}

const SESSION_CAP = 100
const MESSAGE_CAP = 60

/** Strip FTS `[match]` markers + collapse whitespace for a clean one-line title. */
function cleanSnippet(snippet: string): string {
  return snippet.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
}

export function createSessionsSearchProvider(port: ChatSearchPort): SearchProvider {
  return {
    id: 'sessions',
    title: 'Chats',
    tier: 'eager',
    icon: 'session',
    async search(userId, query) {
      const rows = await port
        .listSessions(userId, query.projectId)
        .catch(() => [] as SessionSearchRow[])
      if (query.semantic) {
        return hybridSessionHits(
          { sessions: rows, toUri: sessionUri },
          { ...query, semantic: query.semantic },
          SESSION_CAP,
        )
      }
      const hits: SearchHit[] = []
      for (const s of rows) {
        if (query.projectId !== undefined && s.projectId !== query.projectId) continue
        const score = bestFieldScore([s.title], query.text)
        if (score <= 0) continue
        const isSub = !!s.parentSessionId || s.sessionKind !== 'chat'
        hits.push({
          id: sessionUri(s.id),
          domain: 'sessions',
          title: s.title || '(untitled chat)',
          subtitle: isSub ? `subsession · ${s.sessionKind}` : undefined,
          icon: isSub ? 'subsession' : 'session',
          score,
        })
      }
      return hits.slice(0, SESSION_CAP)
    },
  }
}

/** File name + content search over a session's working dir (ripgrep). */
export interface FileNameHit {
  path: string
  name: string
}
export interface FileContentHit {
  path: string
  line: number
  lineText: string
}
export interface FilesSearchPort {
  findFiles(
    userId: string,
    sessionId: string,
    query: string,
  ): Promise<{ root: string; files: FileNameHit[] }>
  searchContent(
    userId: string,
    sessionId: string,
    query: string,
  ): Promise<{ root: string; matches: FileContentHit[] }>
}

const FILE_NAME_CAP = 20
const FILE_CONTENT_CAP = 40

const toAbsolute = (root: string, rel: string) => (root ? `${root.replace(/\/$/, '')}/${rel}` : rel)

/**
 * FILES provider — file NAME + CONTENT search over the ACTIVE session's working dir
 * via ripgrep (the same engine the file-tree search uses). `eager` but gated on a
 * `sessionId` (no active session ⇒ no cwd ⇒ []), so a default "search everything" DOES
 * include file name + content matches; the registry's per-provider timeout caps the ripgrep.
 * Hit ids are `file://<abs>` (name) / `file://<abs>#L<line>` (content → jumps to the line).
 */
export function createFilesSearchProvider(port: FilesSearchPort): SearchProvider {
  return {
    id: 'files',
    title: 'Files',
    tier: 'eager',
    icon: 'file',
    async search(userId, query) {
      const sessionId = query.sessionId
      if (!sessionId) return [] // no active session ⇒ no cwd to resolve
      const [names, content] = await Promise.all([
        port
          .findFiles(userId, sessionId, query.text)
          .catch(() => ({ root: '', files: [] as FileNameHit[] })),
        port
          .searchContent(userId, sessionId, query.text)
          .catch(() => ({ root: '', matches: [] as FileContentHit[] })),
      ])
      const hits: SearchHit[] = []
      for (const f of names.files.slice(0, FILE_NAME_CAP)) {
        const absolutePath = toAbsolute(names.root, f.path)
        hits.push({
          id: `file://${absolutePath}`,
          uri: localixUiUri('work-item', ['file'], { path: absolutePath }),
          domain: 'files',
          title: f.name,
          subtitle: f.path,
          icon: 'file',
          score: 0.85,
        })
      }
      for (const m of content.matches.slice(0, FILE_CONTENT_CAP)) {
        const line = m.lineText.trim()
        const absolutePath = toAbsolute(content.root, m.path)
        hits.push({
          id: `file://${absolutePath}#L${m.line}`,
          uri: localixUiUri('work-item', ['file'], {
            path: absolutePath,
            line: `${m.line}`,
          }),
          domain: 'files',
          title: line || m.path,
          subtitle: `${m.path}:${m.line}`,
          snippet: m.lineText,
          icon: 'file',
          score: 0.6,
        })
      }
      return hits
    },
  }
}

export function createMessagesSearchProvider(port: ChatSearchPort): SearchProvider {
  return {
    id: 'messages',
    title: 'Messages',
    tier: 'eager',
    icon: 'message',
    async search(userId, query) {
      if (query.semantic && port.hybridReads) {
        const sessions = await port
          .listSessions(userId, query.projectId)
          .catch(() => [] as SessionSearchRow[])
        return hybridMessageHits(
          { reads: port.hybridReads, sessions, toUri: messageUri },
          userId,
          { ...query, semantic: query.semantic },
          MESSAGE_CAP,
        )
      }
      // Best-effort title map so a message hit reads as "in <chat>".
      const [hits, sessions] = await Promise.all([
        port.searchMessages(userId, query.text, MESSAGE_CAP).catch(() => [] as MessageSearchHit[]),
        port.listSessions(userId, query.projectId).catch(() => [] as SessionSearchRow[]),
      ])
      const titleOf = new Map(sessions.map((s) => [s.id, s.title]))
      const projectOf = new Map(sessions.map((s) => [s.id, s.projectId]))
      const results: SearchHit[] = []
      for (const message of hits) {
        if (query.projectId !== undefined && projectOf.get(message.sessionId) !== query.projectId)
          continue
        results.push({
          id: messageUri(message.sessionId, message.messageId),
          domain: 'messages',
          title: titleOf.get(message.sessionId) || cleanSnippet(message.snippet) || 'Message',
          subtitle: `${message.role} · ${cleanSnippet(message.snippet)}`.trim(),
          snippet: message.snippet,
          icon: 'message',
          // FTS returns best-first; decay by rank so the message ordering survives the
          // cross-domain merge without dominating higher-confidence title matches.
          score: Math.max(0.4, 0.85 - results.length * 0.01),
        })
      }
      return results
    },
  }
}

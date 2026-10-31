/**
 * CHAT-NAV RESOURCE PROVIDER (`localix://resource/chat` namespace). Like every
 * registered `ResourceRefProvider`, it exposes its hierarchy as one navigable tree. It exposes the
 * user's chat hierarchy as ONE navigable tree in the composer `@resource:` menu:
 *
 *   roots                         → the user's PROJECTS
 *   localix://resource/chat/project/<projectId>    → that project's root chat SESSIONS  (drill)
 *   localix://resource/chat/session/<sessionId>    → that session's recent MESSAGES     (drill)
 *   localix://resource/chat/message/<sid>/<mid>    → one message (leaf)
 *
 * This is the backend half of the generalized `@`-menu drill-down for the native
 * project → session → message chain. The composer does NOT mint `@resource:localix://resource/chat/…`
 * tokens for these nodes — it maps a `localix://resource/chat` node back to its NATIVE token
 * (`@project:` / `@session:` / `@message:`) at link time (see UI `chatResourceToken.ts`),
 * so pills/expanders/drag stay identical to the just-shipped native ref kinds. This
 * provider therefore only needs cheap LISTING; `expand` delegates to the same
 * digest loaders the native kinds already use, purely as a safety net for anyone
 * who types `@resource:localix://resource/chat/…` by hand.
 *
 * SECURITY: listing + expansion carry INTROSPECTION ONLY — project names, session
 * titles/status, and short message previews the user already sees in the UI. No
 * secrets, no connection creds, no file contents (the digest loaders enforce this).
 */
import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import {
  buildResourceUri,
  linkAction,
  noticeNode,
  providerSegments,
  truncationNotice,
} from '@localixai/mini-app-sdk/backend'
import { RESOURCE_PROVIDERS } from '../agent-core/resource-refs/providers'

/** Core-owned chat provider key — derived from the shared vocabulary, never re-spelled. */
const PROVIDER = RESOURCE_PROVIDERS.chat

/** Max message previews listed under a session (newest first). */
export const CHAT_NAV_MAX_MESSAGES = 40
/** Chars kept from a message body for a menu-row preview. */
const PREVIEW_CHARS = 72

export interface ChatNavProject {
  id: string
  name: string
}
export interface ChatNavSession {
  id: string
  title: string
  runtimeStatus: string
  /** ISO timestamp of last activity. */
  updatedAt: string
}
export interface ChatNavMessage {
  id: string
  role: string
  /** Plain-text preview (already flattened + trimmed by the caller). */
  preview: string
}

export interface ChatNavMessagePage {
  /** Newest-first bounded rows. */
  messages: ChatNavMessage[]
  /** True when at least one more visible row exists past the bound. */
  hasMore: boolean
}

export interface ChatNavDeps {
  /** All of the user's projects (roots of the tree). */
  listProjects(userId: string): Promise<ChatNavProject[]>
  /** Root chat sessions belonging to a project, newest first. */
  listProjectSessions(userId: string, projectId: string): Promise<ChatNavSession[]>
  /** Bounded newest-first page for the common no-query session drill. */
  listRecentSessionMessages(
    userId: string,
    sessionId: string,
    limit: number,
  ): Promise<ChatNavMessagePage>
  /** Messages of a session, newest first (already previewed, NOT capped). Used
   *  only for typed queries, which must filter previews before the cap so search
   *  can reach past `CHAT_NAV_MAX_MESSAGES`. */
  listSessionMessages(userId: string, sessionId: string): Promise<ChatNavMessage[]>
  /** Expansion delegates — reuse the native `@project:`/`@session:`/`@message:` digests. */
  loadProjectDigest(userId: string, projectId: string): Promise<string | null>
  loadSessionDigest(userId: string, sessionId: string): Promise<string | null>
  loadMessageDigest(userId: string, sessionId: string, messageId: string): Promise<string | null>
}

const truncate = (s: string, max: number): string => {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

const oneLineDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

export function chatMessagePreview(role: string, text: string): string {
  return truncate(text, PREVIEW_CHARS) || `(${role || 'message'})`
}

export function createChatResourceProvider(deps: ChatNavDeps): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Chats',
    async listChildren(userId, parentUri, query) {
      // ROOTS → projects.
      if (parentUri === null) {
        const projects = await deps.listProjects(userId)
        return projects.map<ResourceNode>((p) => ({
          uri: buildResourceUri(PROVIDER, ['project', p.id]),
          label: p.name || '(unnamed project)',
          detail: 'project',
          hasChildren: true,
          icon: 'project',
          actions: linkAction('Link this project'),
        }))
      }
      const segments = providerSegments(PROVIDER, parentUri)
      if (!segments) return []
      const [kind, a] = segments
      if (kind === 'project' && a) {
        const sessions = await deps.listProjectSessions(userId, a)
        return sessions.map<ResourceNode>((s) => ({
          uri: buildResourceUri(PROVIDER, ['session', s.id]),
          label: s.title || s.id,
          detail: `${s.runtimeStatus} · ${oneLineDate(s.updatedAt)}`,
          hasChildren: true,
          icon: 'session',
          actions: linkAction('Link this session'),
        }))
      }
      if (kind === 'session' && a) {
        const q = query?.trim().toLowerCase()
        // Only typed search needs the complete preview set so it can honour
        // filter-before-cap. Ordinary drill-down uses a bounded DB page.
        let messages: ChatNavMessage[]
        let hasMore: boolean
        let total: number | undefined
        if (q) {
          const all = await deps.listSessionMessages(userId, a)
          const matched = all.filter((m) => m.preview.toLowerCase().includes(q))
          messages = matched.slice(0, CHAT_NAV_MAX_MESSAGES)
          hasMore = matched.length > CHAT_NAV_MAX_MESSAGES
          total = matched.length
        } else {
          const page = await deps.listRecentSessionMessages(userId, a, CHAT_NAV_MAX_MESSAGES)
          messages = page.messages
          hasMore = page.hasMore
        }
        const nodes = messages.map<ResourceNode>((m) => ({
          uri: buildResourceUri(PROVIDER, ['message', a, m.id]),
          label: m.preview,
          detail: m.role,
          hasChildren: false,
          icon: 'message',
        }))
        if (hasMore) {
          nodes.push(
            total !== undefined
              ? truncationNotice(
                  buildResourceUri(PROVIDER, ['session', a]),
                  messages.length,
                  total,
                  'messages',
                  q,
                )
              : noticeNode(
                  buildResourceUri(PROVIDER, ['session', a]),
                  `Showing newest ${messages.length} messages`,
                  'type to search the full list',
                ),
          )
        }
        return nodes
      }
      return []
    },
    async expand(userId, uri): Promise<ResourceExpansion> {
      const segments = providerSegments(PROVIDER, uri)
      if (!segments) return { ok: false, error: `not a chat resource: ${uri}` }
      const [kind, a, b] = segments
      let content: string | null = null
      if (kind === 'project' && a) content = await deps.loadProjectDigest(userId, a)
      else if (kind === 'session' && a) content = await deps.loadSessionDigest(userId, a)
      else if (kind === 'message' && a && b) content = await deps.loadMessageDigest(userId, a, b)
      return content !== null
        ? { ok: true, content }
        : { ok: false, error: `chat resource not found: ${uri}` }
    },
  }
}

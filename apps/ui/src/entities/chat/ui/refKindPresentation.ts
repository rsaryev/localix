/**
 * Presentation + navigation map for context-ref KINDS — the UI half of the
 * ref-kind registry (`@localixai/api/context-refs` owns the grammar). ONE entry
 * per kind: the icon every surface uses (composer chips + sent-message pills)
 * and the optional open action a pill/chip click fires. Keyed `Record` over
 * `ContextRefKind`, so adding a kind to the registry FORCES an entry here at
 * type level — no per-kind special cases scattered in components.
 *
 * Open actions route through existing chokepoints only (inspectorBus, the
 * message-search scroll seam, router paths) — a kind with no sensible target
 * returns null and its pill renders inert.
 */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Braces,
  Blocks,
  Database,
  File,
  Folder,
  FolderGit2,
  KeyRound,
  MessageSquare,
  MessagesSquare,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { localixUriNamespace } from '@localixai/mini-app-sdk/ui'

import { refLabel, type ContextRefKind, type ParsedContextRef } from '@localixai/api/context-refs'
import type { ContextRef } from '@/shared/api/contracts'
import { resolveUiAnchor } from '@/shared/contrib/uiAnchors'
import { workItemRequestOf } from '@/shared/hooks/useUiNavigation'
import { inspector } from '@/shared/lib/inspectorBus'
import { scopePath } from '@/shared/routing/routes'
import { useChatStore } from '../model/store'
import { selectRefLabelValues } from './refLabelSelector'
import { ringMessage } from './messageRing'
import { capabilityUiUri, parseCapabilityResourceUri } from '@localixai/mini-app-sdk/navigation'

export const REF_KIND_ICONS: Record<ContextRefKind, LucideIcon> = {
  file: File,
  folder: Folder,
  session: MessagesSquare,
  project: FolderGit2,
  message: MessageSquare,
  terminal: SquareTerminal,
  call: Wrench,
  resource: Database,
  snippet: Braces,
}

/** Icon for a kind string (unknown/legacy kinds fall back to the file glyph). */
export function refKindIcon(kind: string): LucideIcon {
  return REF_KIND_ICONS[kind as ContextRefKind] ?? File
}

/** Resource-aware icon for linked refs; Vault keeps its key glyph in chat. */
export function refIcon(ref: Pick<ContextRef, 'kind' | 'uri'>): LucideIcon {
  if (ref.kind === 'resource' && ref.uri && localixUriNamespace(ref.uri) === 'vault')
    return KeyRound
  if (ref.kind === 'resource' && ref.uri && localixUriNamespace(ref.uri) === 'capability')
    return Blocks
  return refKindIcon(ref.kind)
}

export interface RefOpenContext {
  /** The session whose transcript hosts the pill (scopes call/terminal targets). */
  sessionId: string | null
  /** Router navigation (pills can't use hooks per-kind — the component passes it in). */
  navigate: (path: string) => void
  /** Central URI navigation used by capability resources. */
  navigateUi?: (uri: string) => void
}

/** Scroll the transcript to the message containing `toolCallId` (reuses the
 *  message-search scroll+ring seam; auto-clears the ring after a beat).
 *  Resolved at CLICK time so late-loading messages are still found. */
function scrollToToolCall(sessionId: string, toolCallId: string): void {
  const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)
  const hit = session?.messages.find((m) =>
    (m.items ?? []).some(
      (it) =>
        'toolCallId' in it && (it as { toolCallId?: string }).toolCallId?.startsWith(toolCallId),
    ),
  )
  if (hit) ringMessage(hit.id)
}

/**
 * Resolve the click action for one ref — null = inert pill. One registry-keyed
 * map; every action reuses an existing open route (editor, chat route, terminal
 * pane, transcript scroll).
 */
export const REF_OPEN_ACTIONS: Record<
  ContextRefKind,
  (ref: ContextRef, ctx: RefOpenContext) => (() => void) | null
> = {
  // A file ref names a path, not a chat: it opens in the chat whose pill was clicked, and a pill
  // with no chat is inert.
  file: (ref, ctx) => {
    const path = ref.path
    const host = ctx.sessionId
    return path && host
      ? () => inspector.openFile({ sessionId: host, path, line: ref.startLine })
      : null
  },
  // A folder listing has no dedicated surface; the editor can't open a dir.
  folder: () => null,
  session: (ref, ctx) => {
    const target = ref.sessionId
    // Encode the link hierarchically as scope→session: resolve the target's
    // project from the store so the URL identifies WHERE the chat lives (opening
    // it switches scope). The URL is the single source of truth for scope, so we
    // ALWAYS carry the session's own project in the path.
    return target
      ? () => {
          const projectId = useChatStore
            .getState()
            .allSessions.find((s) => s.id === target)?.projectId
          if (projectId) ctx.navigate(scopePath(projectId, target))
        }
      : null
  },
  // Open the linked project by switching the workspace scope to it (URL is the
  // single source of truth for scope). Reuses the same scope-path the project tabs use.
  project: (ref, ctx) => {
    const projectId = ref.projectId
    return projectId ? () => ctx.navigate(scopePath(projectId, null)) : null
  },
  // Open the linked message: navigate to its host session (resolving the session's
  // own project from the store), then hand the message to the store's focus request — the
  // target transcript rings it once mounted. When the pill already lives in that session's
  // transcript we just ring it (no navigation).
  message: (ref, ctx) => {
    const target = ref.sessionId
    const messageId = ref.messageId
    if (!target || !messageId) return null
    return () => {
      if (target === ctx.sessionId) {
        ringMessage(messageId)
        return
      }
      const store = useChatStore.getState()
      const projectId = store.allSessions.find((s) => s.id === target)?.projectId
      if (projectId) ctx.navigate(scopePath(projectId, target))
      store.requestMessageFocus(target, messageId)
    }
  },
  terminal: (_ref, ctx) => {
    const host = ctx.sessionId
    return host ? () => inspector.openTerminal(host) : null
  },
  call: (ref, ctx) => {
    const callId = ref.toolCallId
    const host = ctx.sessionId
    return callId && host ? () => scrollToToolCall(host, callId) : null
  },
  resource: (ref, ctx) => {
    if (!ref.uri) return null
    const capability = parseCapabilityResourceUri(ref.uri)
    if (capability && ctx.navigateUi) {
      return () => ctx.navigateUi?.(capabilityUiUri(capability))
    }
    const target = resolveUiAnchor(ref.uri)
    if (target?.kind !== 'work-item') return null
    // The anchor's own session wins; else the pill's chat. With neither, the grid refuses a
    // session kind rather than guessing one — the same rule every URI navigation follows.
    return () => inspector.openWorkItem(workItemRequestOf(target, ctx.sessionId))
  },
  // A snippet's content is captured inline (no navigable source) — the pill is a
  // label + icon only.
  snippet: () => null,
}

export function refOpenAction(ref: ContextRef, ctx: RefOpenContext): (() => void) | null {
  return REF_OPEN_ACTIONS[ref.kind as ContextRefKind]?.(ref, ctx) ?? null
}

/** A raw opaque id (container hash, connection/project uuid) shortened to a
 *  readable prefix when no better label exists for a resource node. */
function shortenOpaqueId(label: string): string {
  return /^[0-9a-f][0-9a-f-]{19,}$/i.test(label) ? `${label.slice(0, 12)}…` : label
}

/** Store-derived lookups the display label enriches from. */
export interface RefLabelSources {
  sessionTitle: (id: string) => string | undefined
  projectName: (id: string) => string | undefined
  messagePreview: (sessionId: string, messageId: string) => string | undefined
}

/**
 * ONE display label for a ref, shared by the composer chips and the sent-message
 * pills (they had diverged: chips showed raw project UUIDs / message ids where
 * pills showed names/previews). Falls back to the pure token label.
 */
export function refDisplayLabel(ref: ParsedContextRef, src: RefLabelSources): string {
  if (ref.kind === 'session' && ref.sessionId)
    return src.sessionTitle(ref.sessionId) ?? refLabel(ref)
  if (ref.kind === 'project' && ref.projectId)
    return src.projectName(ref.projectId) ?? refLabel(ref)
  if (ref.kind === 'message' && ref.sessionId && ref.messageId)
    return src.messagePreview(ref.sessionId, ref.messageId) ?? refLabel(ref)
  // A resource may carry an explicit human label (the drag source knows the
  // entity's name where the URI only has an id) — prefer it over the URI tail.
  if (ref.kind === 'resource' && ref.label) return ref.label
  const label = refLabel(ref)
  return ref.kind === 'resource' ? shortenOpaqueId(label) : label
}

/** The store-backed {@link RefLabelSources} both chip/pill surfaces use. */
export function useRefLabelSources(refs: readonly ParsedContextRef[]): RefLabelSources {
  const values = useChatStore(useShallow((state) => selectRefLabelValues(state, refs)))
  return useMemo(
    () => ({
      sessionTitle: (id) =>
        values[refs.findIndex((ref) => ref.kind === 'session' && ref.sessionId === id)],
      projectName: (id) =>
        values[refs.findIndex((ref) => ref.kind === 'project' && ref.projectId === id)],
      messagePreview: (sessionId, messageId) =>
        values[
          refs.findIndex(
            (ref) =>
              ref.kind === 'message' && ref.sessionId === sessionId && ref.messageId === messageId,
          )
        ],
    }),
    [refs, values],
  )
}

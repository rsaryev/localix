// Maps the shared inspector open-request channel (InspectorRequest) onto editor-grid
// effects, so existing callers (`inspector.openFile(...)`, agent reveals, the file
// tree, plugin work items, …) drive the grid unchanged once it replaces the inspector docks.
import type { InspectorRequest } from '@/shared/lib/inspectorBus'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { tabIdInScope, workspaceScope, type WorkItem } from '@/entities/workspace-grid/model'

/** Which chats a prefix close reaches (see `workItemIdMatchesPrefix`). */
export interface CloseTarget {
  session?: string
  everyChat?: boolean
  /** The candidate tab's own scope — what `everyChat` strips, never a guess from the id. */
  itemScope?: string
}

export type GridBusEffect =
  | { type: 'open'; item: WorkItem; ephemeral?: boolean; replace?: boolean }
  | { type: 'close'; id: string }
  | { type: 'close-prefix'; prefix: string; session?: string; everyChat?: boolean }
  | { type: 'close-scope'; scope: string }

/**
 * Match an exact work item or one of its colon-delimited children. A caller may pass a
 * prefix already ending in `:` for a raw family. This prevents removing
 * `db-console:abc2` together with `db-console:abc`.
 */
export function workItemIdMatchesPrefix(
  id: string,
  prefix: string,
  target: CloseTarget = {},
): boolean {
  // A session tab is `<id>@<session>` (`tabIdInScope`), so a bare prefix never reached it. Which
  // chats a close reaches is the caller's to say: `session` closes that chat's tabs only (the same
  // card in another chat is a different tab); `everyChat` closes them in every chat — for a thing
  // that is app-wide, like a removed database connection — and reads the suffix from the tab's
  // OWN scope rather than parsing the id; with neither, ids are taken exactly as they are.
  let bare = id
  if (target.session !== undefined) {
    // A sub-session's tabs carry its workspace's suffix (`resolveOpenScope`).
    const suffix = `@${workspaceScope(target.session)}`
    if (!id.endsWith(suffix)) return false
    bare = id.slice(0, -suffix.length)
  } else if (target.everyChat && target.itemScope && id.endsWith(`@${target.itemScope}`)) {
    bare = id.slice(0, -`@${target.itemScope}`.length)
  }
  return prefix.endsWith(':')
    ? bare.startsWith(prefix)
    : bare === prefix || bare.startsWith(`${prefix}:`)
}

/** Translate one InspectorRequest into the grid effect(s) to run. Every session-bound request
 *  names its chat, and its tab is keyed + scoped by THAT chat: the same path opened in two chats
 *  is two independent tabs. The focused chat is never consulted — it used to fill in for a
 *  request that named none, which put one chat's file in another chat's workspace. */
export function inspectorRequestToEffects(req: InspectorRequest): GridBusEffect[] {
  const sessionKey = (prefix: string, sessionId: string, path: string) =>
    `${prefix}:${sessionId}:${path}`
  switch (req.kind) {
    case 'media-file':
      // A stored (dropped/uploaded) file opens by media content id — no on-disk path — keyed
      // by its id within the chat it was opened in, and titled by the original filename.
      return [
        {
          type: 'open',
          item: {
            kind: 'file',
            id: sessionKey('file:media', req.sessionId, req.mediaId),
            title: req.name,
            scope: req.sessionId,
            payload: { path: '', mediaId: req.mediaId, name: req.name, revealAt: Date.now() },
          },
        },
      ]
    case 'file':
      return [
        {
          type: 'open',
          ephemeral: req.ephemeral,
          replace: req.replace,
          item: {
            kind: 'file',
            id: sessionKey('file', req.sessionId, req.path),
            title: baseName(req.path),
            scope: req.sessionId,
            payload: {
              path: req.path,
              line: req.line,
              column: req.column,
              endLine: req.endLine,
              endColumn: req.endColumn,
              // Carried on the payload so re-rendering the tab keeps the choice the OPEN asked
              // for; it is one request's intent, not a stored preference for the file type.
              openWith: req.openWith,
              revealAt: Date.now(),
            },
          },
        },
      ]
    case 'diff':
      return [
        {
          type: 'open',
          ephemeral: req.ephemeral,
          item: {
            kind: 'diff',
            id: sessionKey('diff', req.sessionId, req.path),
            title: req.title ?? baseName(req.path),
            scope: req.sessionId,
            payload: {
              path: req.path,
              diff: req.diff,
              deleted: req.deleted,
              provenance: req.provenance,
              multiFile: req.multiFile,
              rootPath: req.rootPath,
              truncated: req.truncated,
              languagePath: req.languagePath,
              conflict: req.conflict,
              staging: req.staging,
            },
          },
        },
      ]
    // One Browser tab per chat (`tabIdInScope` qualifies the singleton id by its chat).
    case 'preview':
      return [
        {
          type: 'open',
          item: { kind: 'preview', id: 'preview', title: 'Browser', scope: req.sessionId },
        },
      ]
    case 'close-preview':
      return [
        { type: 'close', id: tabIdInScope('preview', 'preview', workspaceScope(req.sessionId)) },
      ]
    case 'close-session':
      // Free the deleted session's ENTIRE scope — its chat tab plus every
      // session-scoped file/diff/table/preview/… tab — in one shot. A sub-session has no scope of
      // its own, so for one the scope close finds nothing and only its chat tab (which lives in its
      // root's workspace) goes; what it opened stays there. Both, unconditionally: by the time a
      // deletion gets here the session has left the tree, so whether it WAS a sub-session is gone.
      return [
        { type: 'close-scope', scope: req.sessionId },
        { type: 'close', id: `chat:${req.sessionId}` },
      ]
    case 'live-file-change':
      return [
        {
          type: 'open',
          ephemeral: true,
          item: {
            kind: 'live-file-change',
            id: `live:${req.change.toolCallId}`,
            title: req.change.title,
            scope: req.change.sessionId,
            payload: { change: req.change },
          },
        },
      ]
    case 'clear-live-file-change':
      return [{ type: 'close', id: `live:${req.toolCallId}` }]
    case 'terminal':
      // Terminals aren't a pure open: creating one needs an async backend PTY, and
      // reveal-or-create depends on what's already open. useGridInspectorBus handles
      // this kind directly via the terminalTabs helper, so no grid effect here.
      return []
    case 'stats':
      return [{ type: 'open', item: { kind: 'stats', id: 'stats', title: 'Usage & Spend' } }]
    case 'settings':
      return [{ type: 'open', item: { kind: 'settings', id: 'settings', title: 'Settings' } }]
    case 'focus-work-item':
      // Handled directly by useGridInspectorBus because it must inspect the live
      // grid and must never synthesize a payload-less replacement WorkItem.
      return []
    case 'work-item':
      // A subsystem-contributed tab. The
      // feature already computed the WorkItemKind, stable id, title, scope and payload —
      // core just opens it, so this mapping names no subsystem.
      return [
        {
          type: 'open',
          ephemeral: req.ephemeral,
          replace: req.replace,
          item: {
            kind: req.workKind,
            id: req.id,
            title: req.title,
            ...(req.scope ? { scope: req.scope } : {}),
            payload: req.payload,
          },
        },
      ]
    case 'close-work-items':
      // Close a group of subsystem tabs by id prefix (the subsystem owns the grammar —
      // e.g. all of one removed db connection's `db-console:<id>[:…]` tabs).
      return [
        {
          type: 'close-prefix',
          prefix: req.prefix,
          ...(req.session !== undefined ? { session: req.session } : {}),
          ...(req.everyChat ? { everyChat: true } : {}),
        },
      ]
    case 'message-replay':
      // The chat's Activity tab; the focused message flows through the message-focus store
      // (set by useGridInspectorBus), not the payload.
      return [
        {
          type: 'open',
          item: {
            kind: 'message-replay',
            id: 'message-replay',
            title: 'Activity',
            scope: req.sessionId,
          },
        },
      ]
    case 'global-search':
      // The chat's Search tab (fixed id → one per chat); seed query in payload.
      return [
        {
          type: 'open',
          item: {
            kind: 'global-search',
            id: 'global-search',
            title: 'Search',
            scope: req.sessionId,
            payload: { query: req.query ?? null, scope: req.scope ?? null },
          },
        },
      ]
  }
}

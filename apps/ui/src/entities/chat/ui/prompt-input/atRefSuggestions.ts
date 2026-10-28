/**
 * atRefSuggestions — PURE suggestion builders for the composer `@`-menu, one per
 * token mode. Extracted from useAtRefAutocomplete (which had every mode's filter +
 * mapping inlined in one 200-line memo): the hook now owns only detection, data
 * fetching and accept/keys, while list shaping lives here where it's unit-testable
 * without React. Each builder takes plain data + the typed partial and returns rows.
 */
import { PARSEABLE_REF_KINDS } from '@localixai/api/context-refs'
import { rankSearchCandidates, type SearchField } from '@localixai/search'
import type { DirEntry, FileSearchEntry, ResourceNode } from '@/shared/api/contracts'
import { resourceActionRows } from './resourceActions'

export interface AtRefSuggestion {
  /** Unique id for React keys. */
  id: string
  /** Main label (e.g. file name or "@diff"). */
  label: string
  description: string
  /** True for directories (accepting keeps the menu open). */
  isDir?: boolean
  /** Kind of action accepting performs — drives how `accept` rewrites the draft. */
  kind: 'type' | 'ref-path' | 'mention' | 'session' | 'project' | 'terminal' | 'call' | 'resource'
  /** For mention/ref-path picks: the path to insert. */
  path?: string
  /** For session picks: the linked session id (e.g. `LOCALIX-42`). */
  sessionId?: string
  /** For project picks: the linked project id. */
  projectId?: string
  /** For terminal/call picks: the exact token text to insert (id pre-shortened). */
  insertToken?: string
  /** For resource picks: the node URI. `hasChildren` keeps the menu open (drill);
   *  `resourceIcon` is the provider's glyph hint the menu maps to a lucide icon. */
  uri?: string
  hasChildren?: boolean
  resourceIcon?: string
  /** Category/folder that only navigates; it cannot be linked into a message. */
  navigationOnly?: boolean
  /** Provider group label for ROOT resource picks (e.g. "Databases") — drives the
   *  `@resource:` menu's section headers. Absent on drilled child nodes. */
  resourceGroup?: string
  /** ACTION rows (the current container's actions, shown at the TOP of a drilled
   *  level, above its children): accepting inserts this text + a trailing space.
   *  When set the row is an action — it always LINKS and never drills. */
  actionInsert?: string
  /** True for an action row (renders a link glyph + "↵ link" hint). */
  isAction?: boolean
  /** For bare-`@` type rows: the ref KIND the row completes to (`file`, `git`,
   *  `resource`…) — the menu derives its glyph from the shared kind→icon map. */
  refKind?: string
}

/** Rows per mode (each list is windowed by the menu itself). */
const LIST_CAP = 20
const WIDE_CAP = 30

export function rankRows<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly SearchField[],
  limit = LIST_CAP,
): T[] {
  return rankSearchCandidates(
    items.map((item) => ({ item, fields: fields(item) })),
    { queries: query, limit, minScore: 0.25 },
  ).map((result) => result.item)
}

/** Hide async rows immediately when the scope that produced them is no longer active. */
export function rowsOwnedBy<T>(rows: T[], shownOwner: string | null, owner: string | null): T[] {
  return shownOwner === owner ? rows : []
}

/** The bare-`@` type menu — the TYPEABLE kinds from the shared ref-kind registry
 *  (structured-only kinds like `snippet` are drag-only, never offered here). */
const TYPE_ROWS: AtRefSuggestion[] = PARSEABLE_REF_KINDS.map((k) => ({
  id: k.menu.insert,
  label: k.menu.label,
  description: k.menu.description,
  kind: 'type' as const,
  refKind: k.kind,
}))

export function buildTypeRows(partial: string): AtRefSuggestion[] {
  const q = partial.toLowerCase()
  return TYPE_ROWS.filter((t) => t.label.slice(1).startsWith(q))
}

export function buildTerminalRows(
  terminals: Array<{ terminalId: string; command?: string; cwd: string }>,
  partial: string,
): AtRefSuggestion[] {
  return rankRows(terminals, partial, (terminal) => [
    { text: terminal.command ?? 'shell', weight: 1 },
    { text: terminal.terminalId, weight: 0.8 },
    { text: terminal.cwd, weight: 0.55 },
  ]).map((t) => ({
    id: t.terminalId,
    label: t.command ?? 'interactive shell',
    description: `${t.cwd} · ${t.terminalId.slice(0, 8)}`,
    kind: 'terminal' as const,
    insertToken: `@terminal:${t.terminalId.slice(0, 8)}`,
  }))
}

/** The transcript-message subset the `@call:` builder reads (newest last). */
export interface CallSourceMessage {
  items?: Array<{
    type?: string
    toolCallId?: unknown
    name?: string
    status?: string
    command?: unknown
  }>
}

export function buildCallRows(
  messages: readonly CallSourceMessage[],
  partial: string,
): AtRefSuggestion[] {
  // Newest-first tool calls from the transcript, deduped by toolCallId.
  const calls: AtRefSuggestion[] = []
  const seen = new Set<string>()
  for (const message of [...messages].reverse()) {
    for (const item of [...(message.items ?? [])].reverse()) {
      if (typeof item.toolCallId !== 'string' || !item.toolCallId || !item.name) continue
      if (seen.has(item.toolCallId)) continue
      seen.add(item.toolCallId)
      const detail =
        item.type === 'command' && typeof item.command === 'string' ? item.command : item.toolCallId
      calls.push({
        id: item.toolCallId,
        label: item.status === 'failed' ? `${item.name} (failed)` : item.name,
        description: detail,
        kind: 'call' as const,
        insertToken: `@call:${item.toolCallId}`,
      })
    }
  }
  return rankRows(calls, partial, (call) => [
    { text: call.label, weight: 1 },
    { text: call.description, weight: 0.75 },
    { text: call.id, weight: 0.7 },
  ])
}

export function buildSessionRows(
  sessions: ReadonlyArray<{ id: string; title: string }>,
  partial: string,
  activeSessionId: string | null,
): AtRefSuggestion[] {
  return rankRows(
    sessions.filter((session) => session.id !== activeSessionId),
    partial,
    (session) => [
      { text: session.title, weight: 1 },
      { text: session.id, weight: 0.75 },
    ],
  ).map((s) => ({
    id: s.id,
    label: s.title || s.id,
    description: s.id,
    kind: 'session' as const,
    sessionId: s.id,
  }))
}

export function buildProjectRows(
  projects: ReadonlyArray<{ id: string; name: string; workingDir: string }>,
  partial: string,
): AtRefSuggestion[] {
  return rankRows(projects, partial, (project) => [
    { text: project.name, weight: 1 },
    { text: project.id, weight: 0.75 },
    { text: project.workingDir, weight: 0.6 },
  ]).map((p) => ({
    id: p.id,
    label: p.name || p.id,
    description: p.workingDir,
    kind: 'project' as const,
    projectId: p.id,
  }))
}

export function buildResourceRows(input: {
  nodes: readonly ResourceNode[]
  segment: string
  parent: string | null
  container: ResourceNode | null
  linkToken: (uri: string) => string
}): AtRefSuggestion[] {
  // ACTIONS-at-top: when browsing a drilled level (no child filter typed yet),
  // head the list with the current container's actions (default "Link this
  // here", or a provider-declared verb like "Link this commit"). Hidden while
  // the user is filtering children so the flat keyboard index stays predictable.
  const actionRows: AtRefSuggestion[] =
    input.segment === ''
      ? resourceActionRows(input.parent, input.container, input.linkToken).map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          kind: 'resource' as const,
          isAction: true,
          actionInsert: a.insert,
        }))
      : []
  const childRows: AtRefSuggestion[] = []
  // NOTICE rows (truncation, a failed read) are not selectable children —
  // they surface separately as plain hint rows (the hook's `notices`).
  // Search, provider grouping, ordering and the cap are owned by the backend.
  for (const node of input.nodes) {
    if (node.notice) continue
    childRows.push({
      id: node.uri,
      label: node.label,
      description: node.detail ?? '',
      isDir: node.hasChildren,
      kind: 'resource' as const,
      uri: node.uri,
      hasChildren: node.hasChildren,
      resourceIcon: node.icon,
      resourceGroup: node.group,
      navigationOnly: node.navigationOnly,
    })
  }
  return [...actionRows, ...childRows]
}

/** Project-wide search hits → rows (`kind` distinguishes a link-only mention pick
 *  from a `@file:` ref search whose accept expands the file's CONTENTS). */
export function buildSearchHitRows(
  hits: readonly FileSearchEntry[],
  kind: 'mention' | 'ref-path',
): AtRefSuggestion[] {
  return hits.map((hit) => ({
    id: hit.path,
    label: hit.type === 'dir' ? `${hit.name}/` : hit.name,
    description: hit.path.includes('/') ? hit.path.slice(0, hit.path.lastIndexOf('/')) : './',
    isDir: hit.type === 'dir',
    kind,
    path: hit.path,
  }))
}

export function buildRefPathRows(input: {
  entries: readonly DirEntry[]
  dirPart: string
  segment: string
  wantDirsOnly: boolean
}): AtRefSuggestion[] {
  const { entries, dirPart, segment, wantDirsOnly } = input
  // ACTIONS-at-top parity with the resource menu: when browsing INSIDE a
  // directory (a trailing `dir/` and no filter typed), head the list with a
  // "Link this folder" action linking the current directory as `@folder:`.
  const currentDir = dirPart.replace(/\/$/, '')
  const folderAction: AtRefSuggestion[] =
    currentDir !== '' && segment === ''
      ? [
          {
            id: `@folder:${currentDir}#link`,
            label: 'Link this folder',
            description: currentDir,
            kind: 'ref-path' as const,
            isAction: true,
            actionInsert: `@folder:${currentDir}`,
          },
        ]
      : []
  const eligible = entries.filter((entry) => !wantDirsOnly || entry.type === 'dir')
  const dirRows = rankRows(eligible, segment, (entry) => [{ text: entry.name }], WIDE_CAP).map(
    (e) => ({
      id: dirPart + e.name,
      label: e.type === 'dir' ? `${e.name}/` : e.name,
      description: dirPart || './',
      isDir: e.type === 'dir',
      kind: 'ref-path' as const,
      path: dirPart + e.name,
    }),
  )
  return [...folderAction, ...dirRows]
}

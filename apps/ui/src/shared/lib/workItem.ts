// A WorkItem is the generalized "thing that can be a tab": a small, plain,
// serializable record carrying identity (kind+id), presentation
// (title/icon/isDirty), and an opaque payload the renderer reads.
// No React, no resolve() on the object itself — the kind registry (capabilities +
// renderer + reviver) supplies behavior, so this stays pure + unit-testable.

/**
 * The closed host-owned vocabulary. Runtime mini app kinds remain open below, but
 * every policy that must cover host UI can key off this value instead of copying
 * an uncheckable string union. Adding a host renderer starts here and therefore
 * makes every `Record<CoreWorkItemKind, ...>` fail until its metadata is supplied.
 */
export const CORE_WORK_ITEM_KINDS = [
  'chat',
  'file',
  'diff',
  'preview',
  'mini-app-view',
  'live-file-change',
  'stats',
  'problems',
  'settings',
  'terminal',
  'message-replay',
  'transcript',
  'global-search',
] as const

export type CoreWorkItemKind = (typeof CORE_WORK_ITEM_KINDS)[number]

export type WorkItemKind =
  | CoreWorkItemKind
  // Subsystem-contributed kinds (a container workbench, …) register themselves into
  // the open `workItemKindRegistry` (see `shared/contrib`) and are addressed by
  // their registered string. This `(string & {})` member keeps literal
  // autocomplete for the core kinds above while letting any registered kind
  // type-check as a `WorkItemKind` — so core hardcodes no subsystem literal.
  | (string & {})

export interface WorkItem {
  kind: WorkItemKind
  /** Stable identity — drives reveal-existing-vs-open-new and persistence. */
  id: string
  title: string
  /** Optional icon key (resolved to a lucide icon by the widget registry). */
  icon?: string
  /** Dirty dot on the tab (e.g. an unsaved file buffer). */
  isDirty?: boolean
  /** Attention dot on the tab: this hidden tab produced activity the user hasn't
   *  seen yet (e.g. a background terminal that emitted output while off-screen).
   *  Transient like `isDirty` — never persisted; cleared when the tab is shown. */
  attention?: boolean
  /** Occupies the single shared "preview" slot of its group (agent auto-open). */
  ephemeral?: boolean
  /** The scope this tab belongs to — the chat sessionId its opener named (every kind but the
   *  app-level ones), or GLOBAL_SCOPE for an app-level kind (settings/stats/agent). Only the
   *  active session's tabs are VISIBLE; the rest stay in the store (warm) but hidden, and are
   *  freed when their session closes. Resolved on open by `resolveOpenScope`, which refuses a
   *  session kind that names no session; restore drops a stored item that has none. */
  scope?: string
  /** Opaque, kind-specific data the renderer reads (e.g. {path}, {sessionId}). */
  payload?: Record<string, unknown>
}

/** Persisted shape — drops transient presentation, keeps identity + payload. */
export interface SerializedWorkItem {
  kind: WorkItemKind
  id: string
  title: string
  scope?: string
  payload?: Record<string, unknown>
}

// ── Tiered tab identity ─────────────────────────────────────────────────────────
// The open-or-focus decision is keyed by exact tab id, but two opens of the SAME
// document can carry different textual ids (a relative vs absolute path, a `.`
// segment, a differently-titled reveal). This tiered comparator decides whether a
// candidate "is" an already-open tab so the reveal-vs-open-new path can fold them
// instead of stacking a duplicate. Deliberately conservative for a multi-tab editor:
// it never merges two files in different directories, and never merges a path-backed
// tab with a path-less one.

/** The identity-relevant slice of a WorkItem (pure — no React/DOM). */
export interface TabIdentity {
  kind: WorkItemKind
  id: string
  /** Workspace path this tab addresses (`payload.path`); '' / undefined = path-less. */
  path?: string
  /** Declared tab title. */
  title?: string
  /** Optional buffer content for the bounded content-diff tier (rarely known at
   *  open time — the comparator simply skips this tier when it is absent). */
  content?: string
}

/** The tier at which two tabs were judged the same document (most specific first).
 *  `path` for path-backed tabs; `basename`/`content` for path-less buffers. */
export type TabIdentityTier = 'path' | 'basename' | 'content'

/** Beyond this many chars two path-less buffers are treated as distinct rather than
 *  compared byte-for-byte (avoids a pathological large-string compare). */
export const TAB_IDENTITY_CONTENT_CAP = 100_000

/** Extract the identity slice from a WorkItem. */
export function tabIdentityOf(item: WorkItem): TabIdentity {
  const path = typeof item.payload?.path === 'string' ? (item.payload.path as string) : undefined
  const content =
    typeof item.payload?.content === 'string' ? (item.payload.content as string) : undefined
  return { kind: item.kind, id: item.id, path: path || undefined, title: item.title, content }
}

/** Normalize a `/`-separated path for comparison: collapse `.`/empty segments,
 *  resolve `..`, drop a trailing slash. Case-preserving (never folds `/A` and
 *  `/a` — a case-sensitive FS keeps them distinct). */
export function normalizeTabPath(p: string): string {
  if (!p) return ''
  const isAbs = p.startsWith('/')
  const segs: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop()
      else if (!isAbs) segs.push('..')
    } else segs.push(seg)
  }
  return (isAbs ? '/' : '') + segs.join('/')
}

/**
 * Decide whether two tab identities address the same document, returning the tier
 * they matched at (or null). The directory-compatibility guardrail is baked in so
 * two genuinely different files are never merged:
 *   • Either has a path → they are the same document ONLY if BOTH are path-backed
 *     and their NORMALIZED absolute paths are equal (tier `path`). Different paths,
 *     or exactly one path present ("one-has-path is not enough"), never match — a
 *     path-backed tab never merges with a path-less one, and two files in different
 *     directories stay distinct.
 *   • Neither has a path (untitled / media buffers) → fall back to `basename`
 *     (equal declared title = same name) then `content` (byte-identical within the
 *     cap). These looser tiers are confined to path-less buffers by construction.
 * The caller restricts this to same-kind (and typically same-scope) candidates.
 */
export function resolveTabIdentity(a: TabIdentity, b: TabIdentity): TabIdentityTier | null {
  const aHasPath = !!a.path
  const bHasPath = !!b.path

  if (aHasPath || bHasPath) {
    return aHasPath && bHasPath && normalizeTabPath(a.path!) === normalizeTabPath(b.path!)
      ? 'path'
      : null
  }

  if (a.title && b.title && a.title === b.title) return 'basename'

  if (
    a.content !== undefined &&
    b.content !== undefined &&
    a.content.length <= TAB_IDENTITY_CONTENT_CAP &&
    b.content.length <= TAB_IDENTITY_CONTENT_CAP &&
    a.content === b.content
  ) {
    return 'content'
  }

  return null
}

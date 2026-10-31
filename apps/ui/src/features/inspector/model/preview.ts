/**
 * Pure preview-tab state transforms — no React, no store, no DOM. The preview
 * store's actions are thin wrappers over these, which keeps the store small and
 * makes the (slightly fiddly) dedup / active-fallback logic unit testable. A
 * session's previews live in two maps: the ACTIVE entry and the OPEN tabs (the
 * mini-browser strip). There is no separate re-openable history — a closed
 * preview is simply gone until the agent opens one again (simpler + no dead
 * corner-menu to keep in sync).
 */

export interface PreviewEntry {
  /** Set when a chat recorded the tab as a preview (its agent, or a dev-preview open) rather
   *  than as a page the person browsed to: the session that OPENED it, which may be a sub-session
   *  of the workspace whose strip holds it. A session's close-all closes these, never a page the
   *  person opened. */
  originSessionId?: string
  background?: boolean
  userOpened?: boolean
  viewport?: { width: number; height: number } | null
  /** The fixed size came from an agent's width check, not from the person: it is returned to
   *  responsive when the run ends, so the pane is never left pinned after a run. */
  agentViewport?: boolean
  /** Stable opaque tab identity, independent of URL and origin. */
  previewId: string
  url: string
  title?: string
  pinned?: boolean
  version: number
  servedFile?: string
  rootDir?: string
  /** Site refuses iframing → the pane shows its open-in-browser card; the strip-proxy view
   *  is offered on demand. The proxy address is NOT stored: it is an ephemeral port the pane
   *  resolves from the live API before it mounts a frame. */
  frameBlocked?: boolean
  /** Opened as a browser page rather than a dev preview. It keeps the native engine whatever
   *  address it reaches, so a link or redirect to a local server never hands a live page to the
   *  frame mid-visit. */
  nativePage?: boolean
}
/** The CURRENT page per chat session (the tab its Browser shows). */
export type PreviewBySession = Record<string, PreviewEntry>
/** Open tabs per session (lists, deduped by previewId). */
export type PreviewsBySession = Record<string, PreviewEntry[]>

export interface PreviewMaps {
  previewBySession: PreviewBySession
  previewTabsBySession: PreviewsBySession
}

/** Permanently forget all preview state owned by a deleted chat session. Unlike
 * an agent close, session deletion must also remove the persisted map keys. */
export function discardSessionPreviews(m: PreviewMaps, sessionId: string): PreviewMaps | null {
  if (
    !Object.hasOwn(m.previewBySession, sessionId) &&
    !Object.hasOwn(m.previewTabsBySession, sessionId)
  ) {
    return null
  }
  const previewBySession = { ...m.previewBySession }
  const previewTabsBySession = { ...m.previewTabsBySession }
  delete previewBySession[sessionId]
  delete previewTabsBySession[sessionId]
  return { previewBySession, previewTabsBySession }
}

/** A refresh of the same tab keeps what only the earlier open said: who opened it, its size. */
function retainTabFacts(previous: PreviewEntry | undefined, entry: PreviewEntry): PreviewEntry {
  if (previous?.previewId !== entry.previewId) return entry
  return {
    ...entry,
    userOpened: entry.userOpened ?? previous.userOpened,
    // A pin is the person's; an agent reopening the site must not let close-all take the tab.
    pinned: entry.pinned ?? previous.pinned,
    nativePage: entry.nativePage ?? previous.nativePage,
    viewport: entry.viewport === undefined ? previous.viewport : entry.viewport,
    agentViewport: entry.viewport === undefined ? previous.agentViewport : entry.agentViewport,
  }
}

function upsertByOrigin(list: PreviewEntry[], entry: PreviewEntry): PreviewEntry[] {
  const remembered = retainTabFacts(
    list.find((item) => item.previewId === entry.previewId),
    entry,
  )
  return list.some((e) => e.previewId === entry.previewId)
    ? list.map((e) => (e.previewId === entry.previewId ? remembered : e))
    : [...list, remembered]
}

/**
 * Record a freshly-opened preview: upsert its open tab and make it active — unless it was opened
 * in the background while another tab is showing, which it must not replace.
 */
export function recordPreview(m: PreviewMaps, sessionId: string, entry: PreviewEntry): PreviewMaps {
  const active = m.previewBySession[sessionId]
  const remembered = retainTabFacts(
    m.previewTabsBySession[sessionId]?.find((tab) => tab.previewId === entry.previewId) ?? active,
    entry,
  )
  const keepActive = entry.background && active && active.previewId !== entry.previewId
  return {
    previewBySession: { ...m.previewBySession, [sessionId]: keepActive ? active : remembered },
    previewTabsBySession: {
      ...m.previewTabsBySession,
      [sessionId]: upsertByOrigin(m.previewTabsBySession[sessionId] ?? [], remembered),
    },
  }
}

/**
 * Re-point the active static preview at a freshly re-served URL (a new ephemeral port
 * after an API restart). Replaces the old entry across active + tabs by its old
 * previewId, deduping in case the new origin already exists. Returns null if there's no
 * active entry for the session.
 */
export function repointPreview(
  m: PreviewMaps,
  sessionId: string,
  next: PreviewEntry,
): PreviewMaps | null {
  const old = m.previewBySession[sessionId]
  if (!old) return null
  const swap = (list?: PreviewEntry[]) => {
    const mapped = (list ?? []).map((e) => (e.previewId === old.previewId ? next : e))
    const seen = new Set<string>()
    return mapped.filter((e) => !seen.has(e.previewId) && !!seen.add(e.previewId))
  }
  return {
    previewBySession: { ...m.previewBySession, [sessionId]: next },
    previewTabsBySession: {
      ...m.previewTabsBySession,
      [sessionId]: swap(m.previewTabsBySession[sessionId]),
    },
  }
}

/** Switch the active tab. Null if the previewId isn't an open tab. */
export function activatePreview(
  m: PreviewMaps,
  sessionId: string,
  previewId: string,
): PreviewBySession | null {
  const entry = (m.previewTabsBySession[sessionId] ?? []).find((e) => e.previewId === previewId)
  return entry ? { ...m.previewBySession, [sessionId]: entry } : null
}

/** Close one open tab; the active tab falls back to a neighbour (or clears). Null if not open. */
export function closeTab(
  m: PreviewMaps,
  sessionId: string,
  previewId: string,
): Pick<PreviewMaps, 'previewBySession' | 'previewTabsBySession'> | null {
  const open = m.previewTabsBySession[sessionId] ?? []
  const idx = open.findIndex((e) => e.previewId === previewId)
  if (idx === -1) return null
  const remaining = open.filter((e) => e.previewId !== previewId)
  const wasActive = m.previewBySession[sessionId]?.previewId === previewId
  const nextActive = wasActive
    ? (remaining[idx] ?? remaining[idx - 1] ?? remaining[0])
    : m.previewBySession[sessionId]
  const previewBySession = { ...m.previewBySession }
  if (nextActive) previewBySession[sessionId] = nextActive
  else delete previewBySession[sessionId]
  return {
    previewBySession,
    previewTabsBySession: { ...m.previewTabsBySession, [sessionId]: remaining },
  }
}

/**
 * useAtRefAutocomplete — the composer `@`-reference suggestion ENGINE (open state +
 * rows + activeIndex + handleKeyDown, mirroring the slash-command picker's shape so
 * PromptInput wires it the same way).
 *
 * Deliberately thin: token detection is the SHARED `detectToken`
 * (`@localixai/api/context-refs` — one grammar for every composer), list shaping is the pure per-mode
 * builders in `atRefSuggestions.ts`, and this hook owns only what needs React —
 * the data fetching per mode, accept()'s draft rewriting, and the keyboard.
 *
 * The mention search supports filters (all / files / folders / regex), surfaced
 * by AtRefMenu's tab row. Server-side filter + rank; the menu match-highlights
 * names locally via fuzzyMatchPositions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { DirEntry, FileSearchEntry } from '@/shared/api/contracts'
import { useChatStore } from '../../model/store'
import { detectToken } from '@localixai/api/context-refs'
import { useResourceDrill } from './useResourceDrill'
import {
  acceptAtRefSuggestion,
  atRefEmptyLabel,
  atRefHighlightQuery,
  resourceLinkToken,
  splitRefPathPartial,
} from './atRefAccept'
import { useAtRefKeyboard } from './useAtRefKeyboard'
import { useAtRefTerminals } from './useAtRefTerminals'
import {
  selectAtRefProjects,
  selectAtRefSessionMessages,
  selectAtRefSessions,
} from './atRefStoreSelectors'
import {
  buildCallRows,
  buildProjectRows,
  buildRefPathRows,
  buildResourceRows,
  buildSearchHitRows,
  buildSessionRows,
  buildTerminalRows,
  buildTypeRows,
  rowsOwnedBy,
  type AtRefSuggestion,
} from './atRefSuggestions'

export type { AtRefSuggestion } from './atRefSuggestions'

/** The mention-search filter the user can toggle in the menu. */
export type AtRefFilter = 'all' | 'files' | 'folders' | 'regex'

/** A non-interactive notice a listing returned (truncation, a failed read) —
 *  rendered as a plain hint row below the child rows, never selectable. */
export interface AtRefNotice {
  label: string
  detail?: string
}

/** A directory listing and the directory (null = none yet) it belongs to. */
interface OwnedEntries {
  dir: string | null
  rows: DirEntry[]
}
const NO_ENTRIES: OwnedEntries = { dir: null, rows: [] }

export function useAtRefAutocomplete(
  prompt: string,
  setPrompt: (v: string) => void,
  sessionId: string | null,
  /** Caret offset in `prompt` (null = end of text). The menu tracks the token AT
   *  the caret, so a caret parked elsewhere never intercepts Enter/ArrowRight
   *  for a token sitting at the end of the draft. */
  caret: number | null = null,
  /** Mint a COMPLETED link as a structured pinned ref (chip) instead of leaving
   *  the raw token in the text. Returns true when claimed — accept then REMOVES
   *  the typed partial. False → the token text is inserted. */
  linkRef: (token: string) => boolean,
  /** Keep a warm-hidden composer's picker state dormant until it owns focus. */
  active = true,
) {
  const token = useMemo(() => (active ? detectToken(prompt, caret) : null), [active, prompt, caret])
  const sessionMode = token?.mode === 'session'
  const projectMode = token?.mode === 'project'
  // Session-link search runs entirely against the already-loaded session list —
  // no backend round-trip. Excludes the active session (linking to self is a no-op).
  const sessions = useChatStore((state) => selectAtRefSessions(state, sessionMode))
  // Project-link search runs against the already-loaded project list (no round-trip).
  const projects = useChatStore((state) => selectAtRefProjects(state, projectMode))
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState<AtRefFilter>('all')

  // --- ref-path mode: directory listing for @file:/@folder: completion ---
  // The listing and the directory it belongs to travel together, so rows are gated by their owner
  // without reading a ref during render.
  const [entries, setEntries] = useState<OwnedEntries>(NO_ENTRIES)
  const cacheRef = useRef(new Map<string, DirEntry[]>())

  // --- mention mode: project-wide file search results ---
  const [searchHits, setSearchHits] = useState<FileSearchEntry[]>([])
  const reqSeq = useRef(0)

  // --- terminal mode: the session's live PTYs (fetched on menu entry) ---
  const terminalMode = token?.mode === 'terminal'
  const { terminals: currentTerminals } = useAtRefTerminals(terminalMode, sessionId)

  // --- resource mode: unified provider drill-down. A localix://resource/chat node
  //     links back to its NATIVE token. The
  //     drill-down state machine (fetch + cache + container recovery) lives in its
  //     own hook; here we just consume its output for the menu rows. ---
  const resourceMode = token?.mode === 'resource'
  const {
    nodes: resourceNodes,
    notices: resourceNotices,
    pending: resourcePending,
    parent: resourceParent,
    segment: resourceSegment,
    container: resourceContainer,
  } = useResourceDrill({
    active: resourceMode,
    partial: resourceMode ? token.partial : '',
    sessionId,
  })

  // --- call mode: tool calls from THIS session's transcript (already local) ---
  const callMode = token?.mode === 'call'
  const sessionMessages = useChatStore((state) =>
    selectAtRefSessionMessages(state, sessionId, callMode),
  )

  // Reset transient state when the session changes (adjust-during-render so the
  // new session never momentarily shows the old session's data).
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    setEntries(NO_ENTRIES)
    setSearchHits([])
  }
  useEffect(() => {
    cacheRef.current.clear()
  }, [sessionId])

  // Directory part of a ref-path partial ('' = working dir root) and its trailing segment.
  const { dirPart, segment } = splitRefPathPartial(token)

  // A `@file:`/`@folder:` partial with NO slash is a project-wide ref SEARCH
  // (reuses the same file-search backend as the mention) rather than a single-
  // directory listing — so `@file:Prompt` finds PromptInput.tsx anywhere in the
  // tree, not just at the root. A slashed partial (or a bare `@file:`) still
  // navigates a directory via the listing path below.
  const isRefSearch =
    token?.mode === 'ref-path' && token.partial.length > 0 && !token.partial.includes('/')

  // ref-path directory listing (cached per directory). Skipped when the partial
  // is a no-slash project-wide ref SEARCH (handled by the search effect below).
  // Keyed on the DIRECTORY (not the token identity): while an uncached listing is
  // in flight, further keystrokes in the same directory must not cancel + re-issue
  // the same request.
  const refPathListing = Boolean(token?.mode === 'ref-path' && !isRefSearch)
  useEffect(() => {
    if (!refPathListing || !sessionId) return
    const cached = cacheRef.current.get(dirPart)
    if (cached) {
      setEntries({ dir: dirPart, rows: cached })
      return
    }
    // The old directory's names must never be rebuilt under the new prefix.
    setEntries((prev) => (prev.dir === dirPart ? prev : NO_ENTRIES))
    let cancelled = false
    void backendClient
      .listDirectory(sessionId, dirPart || undefined)
      .then((listing) => {
        if (cancelled) return
        cacheRef.current.set(dirPart, listing.entries)
        setEntries({ dir: dirPart, rows: listing.entries })
      })
      .catch(() => {
        if (!cancelled) setEntries(NO_ENTRIES)
      })
    return () => {
      cancelled = true
    }
  }, [refPathListing, dirPart, sessionId])

  // Effects run after render. Gate rows by their owner as well, so even the first
  // render after a directory/session switch cannot expose stale selectable items.
  const currentEntries = rowsOwnedBy(entries.rows, entries.dir, dirPart)

  // Project-wide search, debounced 300ms — drives BOTH mention mode and the
  // no-slash ref-path search above.
  const searchActive = token?.mode === 'mention' || isRefSearch
  const searchQuery = token?.mode === 'mention' || isRefSearch ? token.partial : ''
  // Clear stale hits when the search CONTEXT changes (mention ⇄ @file: ref-search):
  // the previous mode's rows would otherwise show relabelled until the debounced
  // refetch lands. Adjust-during-render, keyed on the mode pair.
  const searchContext = `${token?.mode ?? ''}:${isRefSearch}`
  const [prevSearchContext, setPrevSearchContext] = useState(searchContext)
  if (prevSearchContext !== searchContext) {
    setPrevSearchContext(searchContext)
    if (searchHits.length > 0) setSearchHits([])
  }
  const isRegexQuery = token?.mode === 'mention' && token.partial.startsWith('/')
  const searchMode =
    (token?.mode === 'mention' && filter === 'regex') || isRegexQuery ? 'regex' : 'fuzzy'
  const searchType = isRefSearch
    ? token.kind === 'folder'
      ? 'folders'
      : 'all'
    : filter === 'files'
      ? 'files'
      : filter === 'folders'
        ? 'folders'
        : 'all'
  useEffect(() => {
    if (!token || !searchActive || !sessionId) return
    const seq = ++reqSeq.current
    const id = setTimeout(() => {
      void backendClient
        .searchFiles(sessionId, searchQuery, { limit: 30, mode: searchMode, type: searchType })
        .then((res) => {
          if (seq === reqSeq.current) setSearchHits(res.files)
        })
        .catch(() => {
          if (seq === reqSeq.current) setSearchHits([])
        })
    }, 300)
    return () => clearTimeout(id)
  }, [token, searchActive, searchQuery, sessionId, searchMode, searchType])

  const suggestions: AtRefSuggestion[] = useMemo(() => {
    if (!token) return []
    switch (token.mode) {
      case 'terminal':
        return buildTerminalRows(currentTerminals, token.partial)
      case 'call':
        return buildCallRows(sessionMessages ?? [], token.partial)
      case 'resource':
        return buildResourceRows({
          nodes: resourceNodes,
          segment: resourceSegment,
          parent: resourceParent,
          container: resourceContainer,
          linkToken: resourceLinkToken,
        })
      case 'session':
        return buildSessionRows(sessions, token.partial, sessionId)
      case 'project':
        return buildProjectRows(projects, token.partial)
      case 'type':
        return buildTypeRows(token.partial)
      case 'ref-path':
        // No-slash partial → project-wide ref search results (reusing searchHits);
        // accepting still expands the file's CONTENTS (ref-path kind).
        return isRefSearch
          ? buildSearchHitRows(searchHits, 'ref-path')
          : buildRefPathRows({
              entries: currentEntries,
              dirPart,
              segment,
              wantDirsOnly: token.kind === 'folder',
            })
      case 'mention':
        return buildSearchHitRows(searchHits, 'mention')
    }
  }, [
    token,
    currentEntries,
    segment,
    dirPart,
    searchHits,
    isRefSearch,
    sessions,
    projects,
    sessionId,
    currentTerminals,
    sessionMessages,
    resourceNodes,
    resourceSegment,
    resourceParent,
    resourceContainer,
  ])

  // The partial is part of the signature so an Esc-dismissal is scoped to the
  // EXACT text typed — typing further into the same token reopens the menu
  // (dismissal used to stick for the whole token until deleted back past `@`).
  const tokenSignature = token
    ? `${token.start}:${token.mode}:${token.kind ?? ''}:${token.partial}`
    : null
  // Mention AND ref-path modes stay open with zero hits so the empty-state hint
  // ("type a name to search…") stays reachable while the user narrows — the
  // user otherwise sees a `@file:` token with no guidance. Only the static
  // type-menu closes when it has nothing to offer.
  const isOpen = Boolean(
    token &&
    sessionId &&
    dismissedAt !== tokenSignature &&
    (suggestions.length > 0 ||
      token.mode === 'mention' ||
      token.mode === 'ref-path' ||
      token.mode === 'session' ||
      token.mode === 'project' ||
      token.mode === 'terminal' ||
      token.mode === 'call' ||
      token.mode === 'resource'),
  )

  // Reset selection + dismissal when the token context changes.
  const selectionKey = `${tokenSignature}:${suggestions.length}`
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey)
  if (prevSelectionKey !== selectionKey) {
    setPrevSelectionKey(selectionKey)
    setActiveIndex(0)
  }
  if (dismissedAt && dismissedAt !== tokenSignature) {
    setDismissedAt(null)
  }

  // `action`: 'default' = Enter/click (drill a container, link a leaf — the
  // established convention); 'link' = the `→` key / row hint = LINK the node
  // itself even when it has children (the "link here instead of go deeper" gesture,
  // consistent across resource/chat + folder nodes).
  const accept = useCallback(
    (suggestion: AtRefSuggestion, action: 'default' | 'link' = 'default') => {
      if (!token) return
      acceptAtRefSuggestion({ prompt, token, suggestion, action, setPrompt, linkRef })
    },
    [token, prompt, setPrompt, linkRef],
  )

  const handleKeyDown = useAtRefKeyboard({
    isOpen,
    suggestions,
    activeIndex,
    setActiveIndex,
    accept,
    tokenSignature,
    dismissedAt,
    setDismissedAt,
    token,
    prompt,
    setPrompt,
  })

  return {
    isOpen,
    suggestions,
    activeIndex,
    setActiveIndex,
    accept,
    handleKeyDown,
    // True while a resource drill level is fetching — the menu shows a spinner
    // row instead of vanishing (or leaving the previous level's rows clickable).
    pending: resourceMode && resourcePending,
    // Non-interactive notice rows the current listing carried (truncation, a
    // failed provider read) — rendered as plain hints below the child rows.
    notices: resourceMode
      ? resourceNotices.map<AtRefNotice>((notice) => ({
          label: notice.label,
          detail: notice.detail,
        }))
      : [],
    // Mode-aware empty-state copy (the menu used to say "No matching files."
    // for sessions/projects/resources too).
    emptyLabel: atRefEmptyLabel(token?.mode),
    // Filter tabs are only meaningful for the project-wide mention search.
    showFilters: token?.mode === 'mention',
    filter,
    setFilter,
    // The partial the user is typing — used to match-highlight suggestion labels.
    query: atRefHighlightQuery(token, resourceSegment, segment),
  }
}

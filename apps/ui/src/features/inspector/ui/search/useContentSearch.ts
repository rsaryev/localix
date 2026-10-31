/**
 * useContentSearch — the project content-search (find-in-files) engine, extracted
 * from the former standalone SearchPanel so it can drive the search that now lives
 * INSIDE the Files tree panel. Owns everything search-specific: the match toggles
 * (case / whole-word / regex), include/exclude globs, context lines, the debounced
 * `searchContent` request, the folder→file→match result tree, and the live inline
 * replace preview (the rewrite itself is `useReplaceAll`). The QUERY string is owned by the caller (shared with the
 * filename filter field); this hook only runs when `enabled` and the query is set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useDebouncedQuery } from '@/shared/hooks/useDebouncedQuery'
import type { FileContentMatch } from '@/shared/api/contracts'
import { toggleInSet } from '@localixai/mini-app-sdk/ui/utilities'
import { buildSearchTree, collectNodePaths, type SearchTreeNode } from './searchTree'
import { computeReplacement } from './replacePreview'
import { useReplaceAll } from './useReplaceAll'
import type { ActionFeedbackStore } from '@localixai/kit/action-feedback'
import { useProblemReport, type OwnedProblemReport } from '@/shared/ui/problem-report'
import { searchFailureOf, searchProblemOf, type SearchFailure } from './searchFailure'

export interface ContentSearch {
  caseSensitive: boolean
  setCaseSensitive: (v: boolean) => void
  wholeWord: boolean
  setWholeWord: (v: boolean) => void
  regex: boolean
  setRegex: (v: boolean) => void
  includeGlob: string
  setIncludeGlob: (v: string) => void
  excludeGlob: string
  setExcludeGlob: (v: string) => void
  contextLines: number
  setContextLines: (v: number) => void
  includeIgnored: boolean
  setIncludeIgnored: (v: boolean) => void
  showDetails: boolean
  setShowDetails: (v: boolean) => void
  showReplace: boolean
  setShowReplace: (v: boolean) => void
  replaceText: string
  setReplaceText: (v: string) => void
  confirmReplace: boolean
  setConfirmReplace: (v: boolean) => void
  replacing: boolean
  /** The replace-all answer ("Replaced 3 occurrences…"), shown under the replace field. */
  replaceFeedback: ActionFeedbackStore
  matches: FileContentMatch[]
  truncated: boolean
  /** The chat whose workspace `root` and the matches belong to — a picked match opens there. */
  sessionId: string | null
  root: string | null
  loading: boolean
  collapsed: Set<string>
  tree: SearchTreeNode[]
  fileCount: number
  toggleNode: (key: string) => void
  collapseAll: () => void
  clear: () => void
  previewFor: (m: FileContentMatch) => string | null
  runReplace: () => Promise<void>
  hasResults: boolean
  /** Set when the search itself failed — an empty `matches` then says nothing about
   *  the project. `null` once a search has genuinely completed. */
  error: string | null
  /** The same failure as a durable row, carrying the engine's own words as `detail`. */
  problem: OwnedProblemReport | null
}

export function useContentSearch({
  sessionId,
  query,
  enabled,
  debounceMs = 300,
}: {
  sessionId: string | null
  query: string
  enabled: boolean
  /** Quiet time after typing before the search runs; a test passes 0. */
  debounceMs?: number
}): ContentSearch {
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [includeGlob, setIncludeGlob] = useState('')
  const [excludeGlob, setExcludeGlob] = useState('')
  const [contextLines, setContextLines] = useState(0)
  // Default ON: surface files a parent repo's .gitignore hides (container-of-clones).
  const [includeIgnored, setIncludeIgnored] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [replaceText, setReplaceText] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)

  const [matches, setMatches] = useState<FileContentMatch[]>([])
  // Why there are no matches, when there are none — the sentence the strip shows, the engine's own
  // words kept apart from it, and its kind (see `searchFailure.ts`). `null`: the search ran.
  const [failure, setFailure] = useState<SearchFailure | null>(null)
  const error = failure?.message ?? null
  const [truncated, setTruncated] = useState(false)
  const [root, setRoot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const ownerRef = useRef({ active: false })

  const trimmed = query.trim()
  const active = enabled && !!trimmed
  const searchKey = JSON.stringify([
    sessionId,
    trimmed,
    regex,
    caseSensitive,
    wholeWord,
    includeGlob.trim(),
    excludeGlob.trim(),
    contextLines,
    includeIgnored,
  ])

  // Any completion owned by an older session/mount must not publish a toast or
  // refresh the replacement UI that replaced it.
  useEffect(() => {
    const owner = { active: true }
    ownerRef.current = owner
    return () => {
      owner.active = false
    }
  }, [sessionId])

  // Debounced search; the hook invalidates a request that already left the debounce timer
  // before clearing or superseding it (clearing only the timer cannot stop it in flight).
  const supersedeSearch = useDebouncedQuery(
    [
      sessionId,
      active,
      trimmed,
      regex,
      caseSensitive,
      wholeWord,
      includeGlob,
      excludeGlob,
      contextLines,
      includeIgnored,
      refreshKey,
    ],
    debounceMs,
    {
      run:
        sessionId && active
          ? () =>
              backendClient.searchContent(sessionId, trimmed, {
                limit: 1000,
                regex,
                caseSensitive,
                wholeWord,
                glob: includeGlob.trim() || undefined,
                excludeGlob: excludeGlob.trim() || undefined,
                contextLines: contextLines || undefined,
                // When on, searches nested repos hidden by a parent repo's .gitignore
                // (container-of-clones); toggled from the search bar. Global search stays default.
                includeIgnored,
              })
          : null,
      onIdle: () => {
        setMatches([])
        setTruncated(false)
        setRoot(null)
        setFailure(null)
        setLoading(false)
        setResultKey(null)
        setConfirmReplace(false)
      },
      onStart: () => {
        setLoading(true)
        setConfirmReplace(false)
      },
      onResult: (res) => {
        setMatches(res.matches)
        setTruncated(res.truncated)
        setRoot(res.root)
        setFailure(null)
        setResultKey(searchKey)
      },
      onError: (err) => {
        // A failed search is NOT "no results". In a code search, emptiness is the
        // answer being sought — "No results." is how the user concludes a symbol is
        // unused and deletes it. Keep clearing the stale hits (they belong to the old
        // query), but say WHY the list is empty instead of letting it read as a fact
        // about the project.
        setMatches([])
        setTruncated(false)
        setFailure(searchFailureOf(err, regex))
        setResultKey(null)
      },
      onSettled: () => setLoading(false),
    },
  )

  const tree = useMemo(() => buildSearchTree(matches), [matches])
  const fileCount = useMemo(() => new Set(matches.map((m) => m.path)).size, [matches])

  const toggleNode = useCallback((key: string) => setCollapsed((s) => toggleInSet(s, key)), [])
  const collapseAll = useCallback(() => setCollapsed(new Set(collectNodePaths(tree))), [tree])
  const clear = useCallback(() => {
    setReplaceText('')
    setCollapsed(new Set())
  }, [])

  // Live replace preview: while the Replace row is open and non-empty, each match
  // re-substitutes through the SAME literal/regex/whole-word/smart-case semantics
  // the backend uses, so what you see is what "Replace all" writes.
  const previewActive = showReplace && replaceText.length > 0
  const previewFor = useCallback(
    (m: FileContentMatch): string | null =>
      previewActive
        ? computeReplacement(m.lineText.slice(m.matchStart, m.matchEnd), trimmed, replaceText, {
            regex,
            caseSensitive,
            wholeWord,
          })
        : null,
    [previewActive, trimmed, replaceText, regex, caseSensitive, wholeWord],
  )

  const hasResults = matches.length > 0 && resultKey === searchKey

  // A failed search is a standing condition of this panel: the strip says WHAT, the centre keeps
  // the engine's exact complaint. Mounted unconditionally, `null` while the search is healthy.
  //
  // NOT "Search": the Search tab owns that subject in this same scope, and the two surfaces are
  // routinely open together — one settling the other's row is exactly what the duplicate-owner
  // warning is about.
  const reported = failure ? searchProblemOf(failure, trimmed) : null
  const problem = useProblemReport(
    reported
      ? {
          subject: { label: 'Find in files' },
          problems: [reported.problem],
          consequence: 'blocked',
        }
      : null,
    { scope: 'search', sourceVisible: active, actions: reported?.actions },
  )

  // Supersede any search that observed the pre-replacement filesystem before scheduling the
  // refresh that will observe the rewritten files.
  const onReplaced = useCallback(() => {
    supersedeSearch()
    setRefreshKey((k) => k + 1)
  }, [supersedeSearch])
  // The visible hits may intentionally remain while a newer search is loading; only hits of the
  // current criteria (`hasResults`) may authorize the rewrite.
  const {
    replacing,
    runReplace,
    feedback: replaceFeedback,
  } = useReplaceAll({
    sessionId,
    query: trimmed,
    replaceText,
    criteria: { regex, caseSensitive, wholeWord, includeGlob, excludeGlob, includeIgnored },
    ready: hasResults,
    owner: ownerRef,
    onReplaced,
  })

  return {
    caseSensitive,
    setCaseSensitive,
    wholeWord,
    setWholeWord,
    regex,
    setRegex,
    includeGlob,
    setIncludeGlob,
    excludeGlob,
    setExcludeGlob,
    contextLines,
    setContextLines,
    includeIgnored,
    setIncludeIgnored,
    showDetails,
    setShowDetails,
    showReplace,
    setShowReplace,
    replaceText,
    setReplaceText,
    confirmReplace,
    setConfirmReplace,
    replacing,
    replaceFeedback,
    matches,
    truncated,
    sessionId,
    root,
    loading,
    collapsed,
    tree,
    fileCount,
    toggleNode,
    collapseAll,
    clear,
    previewFor,
    runReplace,
    hasResults,
    error,
    problem,
  }
}

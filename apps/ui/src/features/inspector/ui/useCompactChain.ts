import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react'
import { backendClient } from '@/shared/api/client'
import type { DirEntry } from '@/shared/api/contracts'
import type { DirectoryReadToken, FileTreeGuards } from './useDirectoryLoader'

/* oxlint-disable react-hooks/exhaustive-deps -- refs/setters are stable; preserve the pre-split dependency lists exactly */

type UseCompactChainOptions = {
  sessionId: string | null
  expanded: Set<string>
  guards: FileTreeGuards
  childrenRef: RefObject<Record<string, DirEntry[]>>
  ownsSession: () => boolean
  beginDirectoryRead: (path: string) => DirectoryReadToken
  directoryReadIsCurrent: (path: string, token: DirectoryReadToken) => boolean
  setTruncated: (dirPath: string, truncated?: number) => void
  loadChildren: (path: string) => Promise<boolean>
  setChildrenByPath: Dispatch<SetStateAction<Record<string, DirEntry[]>>>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  setRevealRequest: Dispatch<SetStateAction<{ path: string; intent: number } | null>>
}

export function useCompactChain({
  sessionId,
  expanded,
  guards,
  childrenRef,
  ownsSession,
  beginDirectoryRead,
  directoryReadIsCurrent,
  setTruncated,
  loadChildren,
  setChildrenByPath,
  setExpanded,
  setRevealRequest,
}: UseCompactChainOptions) {
  const { compactIntentRef, revealIntentRef } = guards

  // Collapse every open folder back to the root. Keeps the loaded-children cache
  // so re-expanding is instant; the reveal effect won't re-fire on collapse.
  const collapseAll = useCallback(() => {
    compactIntentRef.current += 1
    revealIntentRef.current += 1
    setRevealRequest(null)
    setExpanded(new Set())
  }, [])

  // Expand a compact chain in ONE click: walk DOWN the single-directory-child run
  // from `start`, loading each level, and mark the DEEPEST reached folder expanded
  // so `computeCompactChain` folds the whole run into one open breadcrumb row.
  const openCompactChain = useCallback(
    async (start: string) => {
      if (!sessionId || !ownsSession()) return
      const intent = ++compactIntentRef.current
      const cache: Record<string, DirEntry[]> = { ...childrenRef.current }
      const fetched: Record<
        string,
        { entries: DirEntry[]; truncated?: number; token: DirectoryReadToken }
      > = {}
      let current = start
      for (let i = 0; i < 64; i++) {
        let entries = cache[current]
        if (!entries) {
          const token = beginDirectoryRead(current)
          try {
            const res = await backendClient.listDirectory(sessionId, current)
            if (
              !ownsSession() ||
              compactIntentRef.current !== intent ||
              !directoryReadIsCurrent(current, token)
            )
              return
            entries = res.entries
            cache[current] = entries
            fetched[current] = { entries, truncated: res.truncated, token }
          } catch {
            break
          }
        }
        if (entries.length === 1 && entries[0].type === 'dir') {
          current = `${current}/${entries[0].name}`
          continue
        }
        break // 0 / ≥2 children or a non-dir child → deepest real folder reached
      }
      if (!ownsSession() || compactIntentRef.current !== intent) return
      if (Object.keys(fetched).length) {
        if (
          Object.entries(fetched).some(
            ([path, value]) => !directoryReadIsCurrent(path, value.token),
          )
        )
          return
        setChildrenByPath((prev) => {
          const next = { ...prev }
          for (const [p, v] of Object.entries(fetched)) next[p] = v.entries
          childrenRef.current = next
          return next
        })
        for (const [p, v] of Object.entries(fetched)) setTruncated(p, v.truncated)
      }
      setExpanded((s) => (s.has(current) ? s : new Set(s).add(current)))
    },
    [sessionId, ownsSession, beginDirectoryRead, directoryReadIsCurrent, setTruncated],
  )

  // Toggle a compact row (its tail = the real folder): collapse if open, else
  // cascade-expand the whole chain. Also the keyboard/normal-dir toggle when
  // compaction is on — `openCompactChain` just loads+expands a plain folder too.
  const toggleCompact = useCallback(
    (endpoint: string) => {
      if (expanded.has(endpoint)) {
        setExpanded((s) => {
          const n = new Set(s)
          n.delete(endpoint)
          return n
        })
      } else {
        void openCompactChain(endpoint)
      }
    },
    [expanded, openCompactChain],
  )

  // Click an INTERMEDIATE breadcrumb segment: reveal its children right there
  // (drill to that level). Collapses back if it's already the drilled level.
  // Mid-chain folders are already loaded, but load defensively.
  const expandCompactAt = useCallback(
    (seg: string) => {
      if (expanded.has(seg)) {
        setExpanded((s) => {
          const n = new Set(s)
          n.delete(seg)
          return n
        })
      } else {
        void loadChildren(seg)
        setExpanded((s) => new Set(s).add(seg))
      }
    },
    [expanded, loadChildren],
  )

  return { collapseAll, toggleCompact, expandCompactAt }
}

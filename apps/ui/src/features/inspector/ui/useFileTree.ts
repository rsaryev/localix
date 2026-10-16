import { useCallback, useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import type { DirEntry } from '@/shared/api/contracts'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { useActiveFilePath } from '../model/fileNav'
import { subscribeRevealInTree } from '@/shared/lib/explorerBus'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useProblemReport } from '@/shared/ui/problem-report'
import { revealAncestors, compactExpandTargets } from './fileTreePaths'
import { useCompactFolders } from './useCompactFolders'
import { useCompactChain } from './useCompactChain'
import { useLiveTreeRefresh } from './useLiveTreeRefresh'
import {
  useDirectoryLoader,
  useFileTreeGuards,
  type DirectoryReadToken,
} from './useDirectoryLoader'
import { useTreeEditing } from './useTreeEditing'
import { useTreeSelection } from './useTreeSelection'
import { useTreeTransfers } from './useTreeTransfers'

/** Namespace for the conditions the explorer publishes. */
const TREE_PROBLEM_SCOPE = 'file-tree'

/** Modifier state of the click/keypress that drove a selection change. */
export type SelectMods = { toggle?: boolean; range?: boolean }

/** An in-tree inline edit: creating a new entry under a folder, or renaming one. */
export type EditState =
  | { mode: 'create'; parentPath: string; kind: 'file' | 'dir' }
  | { mode: 'rename'; path: string; parentPath: string; name: string; kind: 'file' | 'dir' }

/** Pending delete awaiting confirmation. */
export type PendingDelete = { path: string; name: string; type: 'file' | 'dir' }

/**
 * Entries marked for cut/copy, awaiting a paste into a target folder. Holds one
 * path for a single row, or the whole multi-selection (distinct parents) when a
 * batch is clipped. A cut dims every listed path until it's pasted.
 */
export type TreeClipboard = { paths: string[]; mode: 'cut' | 'copy' }

/**
 * The lazy file-tree's data + mutation state machine, split out of
 * FileTreeSidebar so the component stays presentation-only. Owns the loaded
 * children cache, expand/loading sets, create/rename/delete editing, the live
 * fs-change refresh, and the reveal-active-file effect. Returns everything the
 * tree render needs.
 */
export function useFileTree(sessionId: string | null) {
  // Path of the file currently shown in the focused grid group, so the tree can
  // highlight it (and the diff tab's underlying file too) — editor-style feedback.
  const activeFilePath = useActiveFilePath()
  // Fold single-child folder runs into one breadcrumb row.
  const [compactEnabled, toggleCompactEnabled] = useCompactFolders()

  const [root, setRoot] = useState<string | null>(null)
  const [childrenByPath, setChildrenByPath] = useState<Record<string, DirEntry[]>>({})
  // Per-directory count of entries the server omitted because the dir exceeded the
  // listing cap (huge dirs like `.turbo/cache`). Drives the "… N more items" row.
  const [truncatedByPath, setTruncatedByPath] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  // The tree's ONE standing condition: the listing itself could not be read. Held as a Problem,
  // not a string, so the classified sentence and the raw driver text stay separate all the way to
  // the centre. Operation failures (delete/paste/reveal) are events and go to `toast.error`.
  const [error, setError] = useState<Problem | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Disk changes reach the tree on their own; when not (ssh/docker, a failed watcher), the
  // sidebar offers a manual Refresh instead.
  const [live, setLive] = useState(false)
  // Active in-tree create/rename edit + its (server) validation error, if any.
  const [edit, setEdit] = useState<EditState | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Pending delete awaiting confirmation — one entry for a single row, several
  // when a multi-selection is deleted in one batch.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete[] | null>(null)
  // Whether the pending delete is a PERMANENT removal (Shift+Delete) vs the default
  // reversible move-to-trash — drives the confirm-dialog copy and the API flag.
  const [deletePermanent, setDeletePermanent] = useState(false)
  // Multi-selection: path → kind. Batch delete acts on
  // it; a plain click resets it to the one row. `anchorRef` is the pivot a
  // shift-click ranges from.
  const [selected, setSelected] = useState<Map<string, 'file' | 'dir'>>(new Map())
  const anchorRef = useRef<string | null>(null)
  // Entry on the tree clipboard (cut/copy), pasted into a folder later.
  const [clipboard, setClipboard] = useState<TreeClipboard | null>(null)
  // Monotonic reveal request consumed by the virtualized sidebar. The target
  // may not be mounted yet, so the data model — not a DOM query — owns scrolling.
  const [revealRequest, setRevealRequest] = useState<{
    path: string
    intent: number
  } | null>(null)
  const guards = useFileTreeGuards(sessionId, clipboard)
  const { treeEpochRef, revealIntentRef } = guards
  const {
    childrenRef,
    ownsSession,
    beginDirectoryRead,
    directoryReadIsCurrent,
    loadRoot,
    setTruncated,
    reloadDir,
    undoLast,
    toastUndo,
    loadChildren,
    toggle,
  } = useDirectoryLoader({
    sessionId,
    childrenByPath,
    expanded,
    guards,
    anchorRef,
    setRoot,
    setChildrenByPath,
    setTruncatedByPath,
    setExpanded,
    setLoading,
    setError,
    setRefreshing,
    setLive,
    setSelected,
    setRevealRequest,
  })

  const { collapseAll, toggleCompact, expandCompactAt } = useCompactChain({
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
  })

  const { startCreate, startRename, cancelEdit, submitEdit } = useTreeEditing({
    sessionId,
    edit,
    guards,
    ownsSession,
    loadChildren,
    reloadDir,
    toastUndo,
    setExpanded,
    setEdit,
    setEditError,
  })

  const { clearSelection, selectRow, requestDelete, confirmDelete, duplicate } = useTreeSelection({
    sessionId,
    pendingDelete,
    deletePermanent,
    selected,
    guards,
    anchorRef,
    ownsSession,
    reloadDir,
    toastUndo,
    setPendingDelete,
    setDeletePermanent,
    setSelected,
  })

  const { clip, pasteInto, dropEntries } = useTreeTransfers({
    sessionId,
    selected,
    clipboard,
    guards,
    ownsSession,
    reloadDir,
    toastUndo,
    setClipboard,
    setExpanded,
  })

  const reveal = useCallback(
    (path: string) => {
      if (!sessionId || !ownsSession()) return
      backendClient.revealFileEntry(sessionId, path).catch((e) => {
        // Revealing in Finder failing does not make the tree unreadable — and the tree's `error`
        // state is rendered INSTEAD of the tree. One-off event, so it goes to the centre.
        if (ownsSession())
          toast.error('Could not reveal this file in your file manager', {
            description: errorMessage(e, '') || undefined,
          })
      })
    },
    [sessionId, ownsSession],
  )

  // Disk changes, a reconnect's missed frames: see the hook.
  useLiveTreeRefresh(sessionId, childrenRef, reloadDir)

  // Reveal a file in the tree: expand its ancestor folders (loading as needed)
  // and scroll it into view — "reveal in explorer". Returns a cancel fn so an
  // in-flight reveal is dropped when the target changes. Shared by the
  // active-file effect and the explicit "Reveal in Tree" bus below.
  /* oxlint-disable react-hooks/exhaustive-deps -- childrenRef is stable; preserve the pre-split callback dependencies exactly */
  const revealPath = useCallback(
    (path: string): (() => void) => {
      let cancelled = false
      const intent = ++revealIntentRef.current
      const treeEpoch = treeEpochRef.current
      const isCurrent = () =>
        !cancelled &&
        ownsSession() &&
        treeEpochRef.current === treeEpoch &&
        revealIntentRef.current === intent
      if (!path || !root || !sessionId)
        return () => {
          cancelled = true
        }
      const ancestors = revealAncestors(root, path)
      if (!ancestors)
        return () => {
          cancelled = true
        } // file isn't inside root
      void (async () => {
        const cache = { ...childrenRef.current }
        const missing = ancestors.filter((dir) => !cache[dir])
        if (missing.length) {
          let fetched: {
            dir: string
            entries: DirEntry[]
            truncated?: number
            token: DirectoryReadToken
          }[]
          try {
            fetched = await Promise.all(
              missing.map(async (dir) => {
                const token = beginDirectoryRead(dir)
                const res = await backendClient.listDirectory(sessionId, dir)
                return { dir, entries: res.entries, truncated: res.truncated, token }
              }),
            )
          } catch {
            return
          }
          if (!isCurrent() || fetched.some((f) => !directoryReadIsCurrent(f.dir, f.token))) return
          for (const f of fetched) cache[f.dir] = f.entries
          setChildrenByPath((prev) => {
            const next = { ...prev }
            for (const f of fetched) next[f.dir] = f.entries
            childrenRef.current = next
            return next
          })
          for (const f of fetched) setTruncated(f.dir, f.truncated)
        }
        if (!isCurrent()) return
        // With compaction on, expand only the chain tails covering the path so the
        // revealed branch stays folded (naively expanding every ancestor un-folds it).
        const toExpand = compactEnabled
          ? (compactExpandTargets(root, path, cache) ?? ancestors)
          : ancestors
        setExpanded((s) => {
          let changed = false
          const n = new Set(s)
          for (const d of toExpand)
            if (!n.has(d)) {
              n.add(d)
              changed = true
            }
          return changed ? n : s
        })
        if (isCurrent()) setRevealRequest({ path, intent })
      })()
      return () => {
        cancelled = true
        if (revealIntentRef.current === intent) {
          revealIntentRef.current += 1
          setRevealRequest((current) => (current?.intent === intent ? null : current))
        }
      }
    },
    [
      root,
      sessionId,
      ownsSession,
      beginDirectoryRead,
      directoryReadIsCurrent,
      setTruncated,
      compactEnabled,
    ],
  )
  /* oxlint-enable react-hooks/exhaustive-deps */

  // Auto-reveal the active file. Triggers only when the open file changes, so
  // folders the user collapsed aren't disturbed during normal browsing.
  useEffect(() => {
    if (!activeFilePath) return
    return revealPath(activeFilePath)
  }, [activeFilePath, revealPath])

  // Explicit "Reveal in Tree" from the editor tab menu — reveals the requested
  // path even when it's already the active file (a manual re-scroll), and once
  // `root` loads for a freshly-opened Files section.
  useEffect(
    () =>
      subscribeRevealInTree((path) => {
        revealPath(path)
      }),
    [revealPath],
  )

  // Derived, never published from the setter: the tree's failure is state, and the hook is what
  // turns state into a durable row — including settling it the moment a reload succeeds.
  const problem = useProblemReport(
    error ? { subject: { label: 'Files' }, problems: [error], consequence: 'blocked' } : null,
    { scope: TREE_PROBLEM_SCOPE, sourceVisible: true },
  )

  return {
    sessionId,
    activeFilePath,
    root,
    childrenByPath,
    truncatedByPath,
    expanded,
    loading,
    problem,
    refreshing,
    live,
    edit,
    editError,
    pendingDelete,
    setPendingDelete,
    selected,
    selectRow,
    clearSelection,
    requestDelete,
    deletePermanent,
    duplicate,
    undoLast,
    clipboard,
    clip,
    pasteInto,
    dropEntries,
    revealRequest,
    loadRoot,
    reloadDir,
    toggle,
    collapseAll,
    compactEnabled,
    toggleCompactEnabled,
    toggleCompact,
    expandCompactAt,
    startCreate,
    startRename,
    cancelEdit,
    submitEdit,
    confirmDelete,
    reveal,
    isSessionCurrent: ownsSession,
  }
}

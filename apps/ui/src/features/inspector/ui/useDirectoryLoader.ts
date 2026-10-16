import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { backendClient } from '@/shared/api/client'
import type { DirEntry } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { basenameOf } from './fileTreePaths'
import { createUndoTokens, type UndoTokens } from './undoTokens'
import { useTreeUndo } from './useTreeUndo'
import type { TreeClipboard } from './useFileTree'

/* oxlint-disable react-hooks/exhaustive-deps -- refs/setters are stable; preserve the pre-split dependency lists exactly */

export type DirectoryReadToken = { epoch: number; seq: number }

/**
 * The file tree's single owner for every async ownership, epoch, and sequence
 * guard. All four state machines receive this same object: duplicating any ref
 * would let a stale response from one machine escape invalidation by another.
 */
export type FileTreeGuards = {
  ownerRef: RefObject<string | null>
  treeEpochRef: RefObject<number>
  directoryReadSeqRef: RefObject<Map<string, number>>
  directoryLoadingCountRef: RefObject<Map<string, number>>
  directoryLoadInFlightRef: RefObject<Map<string, { epoch: number; promise: Promise<boolean> }>>
  compactIntentRef: RefObject<number>
  revealIntentRef: RefObject<number>
  editIntentRef: RefObject<number>
  editSubmitRef: RefObject<number | null>
  undoInFlightRef: RefObject<Promise<void> | null>
  undoTokensRef: RefObject<UndoTokens>
  deleteInFlightRef: RefObject<boolean>
  clipboardRef: RefObject<TreeClipboard | null>
}

type RevealRequest = { path: string; intent: number } | null
type Selection = Map<string, 'file' | 'dir'>

export function useFileTreeGuards(
  sessionId: string | null,
  clipboard: TreeClipboard | null,
): FileTreeGuards {
  // This hook is mounted for exactly one session by FileTreeSidebar. Async work
  // pins that owner and checks it again before any state/global side effect; the
  // cleanup flips it to null before a late response can affect the next workspace.
  const ownerRef = useRef<string | null>(sessionId)
  const treeEpochRef = useRef(0)
  const directoryReadSeqRef = useRef(new Map<string, number>())
  const directoryLoadingCountRef = useRef(new Map<string, number>())
  const directoryLoadInFlightRef = useRef(
    new Map<string, { epoch: number; promise: Promise<boolean> }>(),
  )
  const compactIntentRef = useRef(0)
  const revealIntentRef = useRef(0)
  const editIntentRef = useRef(0)
  const editSubmitRef = useRef<number | null>(null)
  const undoInFlightRef = useRef<Promise<void> | null>(null)
  const undoTokensRef = useRef<UndoTokens>(createUndoTokens())
  const deleteInFlightRef = useRef(false)
  const clipboardRef = useRef<TreeClipboard | null>(clipboard)

  useEffect(() => {
    ownerRef.current = sessionId
    const inFlightDirectoryLoads = directoryLoadInFlightRef.current
    return () => {
      ownerRef.current = null
      treeEpochRef.current += 1
      inFlightDirectoryLoads.clear()
      compactIntentRef.current += 1
      revealIntentRef.current += 1
      editIntentRef.current += 1
    }
  }, [sessionId])

  return {
    ownerRef,
    treeEpochRef,
    directoryReadSeqRef,
    directoryLoadingCountRef,
    directoryLoadInFlightRef,
    compactIntentRef,
    revealIntentRef,
    editIntentRef,
    editSubmitRef,
    undoInFlightRef,
    undoTokensRef,
    deleteInFlightRef,
    clipboardRef,
  }
}

type UseDirectoryLoaderOptions = {
  sessionId: string | null
  childrenByPath: Record<string, DirEntry[]>
  expanded: Set<string>
  guards: FileTreeGuards
  anchorRef: RefObject<string | null>
  setRoot: Dispatch<SetStateAction<string | null>>
  setChildrenByPath: Dispatch<SetStateAction<Record<string, DirEntry[]>>>
  setTruncatedByPath: Dispatch<SetStateAction<Record<string, number>>>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  setLoading: Dispatch<SetStateAction<Set<string>>>
  setError: Dispatch<SetStateAction<Problem | null>>
  setRefreshing: Dispatch<SetStateAction<boolean>>
  /** Whether disk changes reach the tree on their own — reported by every root/re-list read. */
  setLive: Dispatch<SetStateAction<boolean>>
  setSelected: Dispatch<SetStateAction<Selection>>
  setRevealRequest: Dispatch<SetStateAction<RevealRequest>>
}

export function useDirectoryLoader({
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
}: UseDirectoryLoaderOptions) {
  const {
    ownerRef,
    treeEpochRef,
    directoryReadSeqRef,
    directoryLoadingCountRef,
    directoryLoadInFlightRef,
  } = guards

  const ownsSession = useCallback(
    () => Boolean(sessionId) && ownerRef.current === sessionId,
    [sessionId],
  )

  const beginDirectoryRead = useCallback((path: string): DirectoryReadToken => {
    const seq = (directoryReadSeqRef.current.get(path) ?? 0) + 1
    directoryReadSeqRef.current.set(path, seq)
    return { epoch: treeEpochRef.current, seq }
  }, [])
  const directoryReadIsCurrent = useCallback(
    (path: string, token: DirectoryReadToken): boolean =>
      ownsSession() &&
      treeEpochRef.current === token.epoch &&
      directoryReadSeqRef.current.get(path) === token.seq,
    [ownsSession],
  )

  // Read latest loaded children inside the reveal effect without making it a dep.
  const childrenRef = useRef(childrenByPath)
  useEffect(() => {
    childrenRef.current = childrenByPath
  }, [childrenByPath])

  // Every root refresh starts a new tree epoch. It supersedes older root reads
  // AND every child-directory read issued against the previous snapshot.
  const loadRoot = useCallback(() => {
    if (!sessionId || !ownsSession()) return
    const epoch = ++treeEpochRef.current
    directoryReadSeqRef.current.clear()
    directoryLoadingCountRef.current.clear()
    directoryLoadInFlightRef.current.clear()
    setRefreshing(true)
    backendClient
      .listDirectory(sessionId)
      .then((res) => {
        if (!ownsSession() || treeEpochRef.current !== epoch) return
        const nextChildren = { [res.path]: res.entries }
        childrenRef.current = nextChildren
        setRoot(res.path)
        setChildrenByPath(nextChildren)
        setTruncatedByPath(res.truncated ? { [res.path]: res.truncated } : {})
        setExpanded(new Set())
        setLoading(new Set())
        setSelected(new Map())
        setRevealRequest(null)
        anchorRef.current = null
        setError(null)
        setLive(res.live === true)
      })
      .catch((e) => {
        if (ownsSession() && treeEpochRef.current === epoch)
          setError({
            message: 'Could not read this workspace folder.',
            hint: 'Check that the folder still exists and that you can open it.',
            // The driver's own words — an ENOENT path, an SSH refusal — belong here, not on a
            // line across the sidebar. `errorMessage(e, 'Failed to load files')` put them there.
            detail: errorMessage(e, '') || undefined,
          })
      })
      .finally(() => {
        if (ownsSession() && treeEpochRef.current === epoch) setRefreshing(false)
      })
  }, [sessionId, ownsSession])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount/session load kicks off the directory fetch; epoch/owner guards drop stale responses
    loadRoot()
  }, [loadRoot])

  // Record (or clear) a directory's omitted-entry count from a fresh listing.
  const setTruncated = useCallback((dirPath: string, truncated?: number) => {
    setTruncatedByPath((prev) => {
      if (truncated) return prev[dirPath] === truncated ? prev : { ...prev, [dirPath]: truncated }
      if (!(dirPath in prev)) return prev
      const next = { ...prev }
      delete next[dirPath]
      return next
    })
  }, [])

  // Re-fetch one directory's children after a mutation so the tree reflects disk.
  //
  // `quiet` is for the fs-watch refresh queue only. That caller fires during heavy churn — a build,
  // an agent rewriting a tree — where a failed read is usually a file that vanished mid-listing and
  // the next frame refreshes it anyway; reporting each one would be a stream of toasts nobody can
  // act on. Every other caller is a mutation the person just made, and a folder that silently keeps
  // showing its pre-edit contents is the tree lying about their own action.
  const reloadDir = useCallback(
    async (dirPath: string, options?: { quiet?: boolean }) => {
      if (!sessionId || !ownsSession()) return false
      const token = beginDirectoryRead(dirPath)
      try {
        const res = await backendClient.listDirectory(sessionId, dirPath)
        if (!directoryReadIsCurrent(dirPath, token)) return false
        setChildrenByPath((prev) => {
          const next = { ...prev, [dirPath]: res.entries }
          childrenRef.current = next
          return next
        })
        setTruncated(dirPath, res.truncated)
        setLive(res.live === true)
        return true
      } catch (e) {
        if (!options?.quiet && ownsSession() && directoryReadIsCurrent(dirPath, token))
          toast.error(`Could not refresh “${basenameOf(dirPath)}”`, {
            description: [errorMessage(e, ''), 'The folder may still show its previous contents.']
              .filter(Boolean)
              .join(' '),
          })
        return false
      }
    },
    [sessionId, ownsSession, beginDirectoryRead, directoryReadIsCurrent, setTruncated],
  )

  // ⌘Z and each change row's Undo, bound to the change it names.
  const { undoLast, toastUndo } = useTreeUndo({ sessionId, guards, ownsSession, reloadDir })

  const loadChildren = useCallback(
    (path: string): Promise<boolean> => {
      if (childrenRef.current[path]) return Promise.resolve(true)
      if (!sessionId || !ownsSession()) return Promise.resolve(false)
      const epoch = treeEpochRef.current
      // Expand, create, and compact-folder actions can converge on the same
      // missing directory in one frame. Join that read through a keyed
      // pending-fetch map; sequence guards alone only discard one duplicate
      // after both RPCs have already crossed the local/SSH/Docker boundary.
      const pending = directoryLoadInFlightRef.current.get(path)
      if (pending?.epoch === epoch) return pending.promise
      const token = beginDirectoryRead(path)
      directoryLoadingCountRef.current.set(
        path,
        (directoryLoadingCountRef.current.get(path) ?? 0) + 1,
      )
      setLoading((s) => new Set(s).add(path))
      const task = (async () => {
        try {
          const res = await backendClient.listDirectory(sessionId, path)
          if (!directoryReadIsCurrent(path, token)) return false
          setChildrenByPath((prev) => {
            const next = { ...prev, [path]: res.entries }
            childrenRef.current = next
            return next
          })
          setTruncated(path, res.truncated)
          return true
        } catch (e) {
          // Swallowed, this is indistinguishable from an empty folder: you click a directory and
          // nothing opens. The row stays childless (there is nothing truthful to show), but the
          // reason is now reachable instead of gone.
          if (ownsSession() && directoryReadIsCurrent(path, token))
            toast.error(`Could not list “${basenameOf(path)}”`, {
              description: errorMessage(e, '') || undefined,
            })
          return false
        } finally {
          const remaining = Math.max(0, (directoryLoadingCountRef.current.get(path) ?? 1) - 1)
          if (remaining) directoryLoadingCountRef.current.set(path, remaining)
          else directoryLoadingCountRef.current.delete(path)
          if (ownsSession() && remaining === 0)
            setLoading((s) => {
              const n = new Set(s)
              n.delete(path)
              return n
            })
        }
      })()
      directoryLoadInFlightRef.current.set(path, { epoch, promise: task })
      const clear = () => {
        if (directoryLoadInFlightRef.current.get(path)?.promise === task) {
          directoryLoadInFlightRef.current.delete(path)
        }
      }
      void task.then(clear, clear)
      return task
    },
    [sessionId, ownsSession, beginDirectoryRead, directoryReadIsCurrent, setTruncated],
  )

  const toggle = useCallback(
    async (path: string) => {
      if (expanded.has(path)) {
        setExpanded((s) => {
          const n = new Set(s)
          n.delete(path)
          return n
        })
        return
      }
      setExpanded((s) => new Set(s).add(path))
      await loadChildren(path)
    },
    [expanded, loadChildren],
  )

  return {
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
  }
}

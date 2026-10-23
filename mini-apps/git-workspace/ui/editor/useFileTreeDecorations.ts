import { useMemo } from 'react'
import type { RepoChangeStatus, SourceControlStatus } from '../../backend/source-control/contracts'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import {
  useSessionGitField,
  useSessionRepoRoots,
  useSourceControlStore,
} from '../source-control/model/store'
import type { FileTreeDecorationIndex } from '@localixai/plugin-sdk/ui'
import { toast } from '@localixai/plugin-sdk/ui'
import { relativePath } from '@localixai/plugin-sdk/ui/utilities'
import { statusMeta } from '../source-control/ui/statusMeta'
import { gitFailed } from '../source-control/model/gitFailure'

export interface TreeGitIndex {
  /** Change status for a file at an absolute path, or undefined when unchanged. */
  statusFor: (absPath: string) => RepoChangeStatus | undefined
  /** Whether a directory (absolute path) contains any changed file below it. */
  dirHasChanges: (absPath: string) => boolean
  /** True when the working tree has any change at all (cheap render gate). */
  dirty: boolean
  /** Repository whose `.gitignore` should own an absolute tree path. */
  gitignoreRootFor: (absPath: string) => string | null
}

const EMPTY_INDEX: TreeGitIndex = {
  statusFor: () => undefined,
  dirHasChanges: () => false,
  dirty: false,
  gitignoreRootFor: () => null,
}

/** Deepest repository wins when repos are nested. */
export function owningRepoRoot(repoRoots: readonly string[], absPath: string): string | null {
  let owner: string | null = null
  for (const candidate of repoRoots) {
    const root = candidate.replace(/\/$/, '')
    if (isAtOrUnder(root, absPath) && (!owner || root.length > owner.length)) owner = root
  }
  return owner
}

/**
 * A nested repository's ROOT folder is ignored by its parent repository, not by
 * its own `.gitignore` (where the relative pattern would be empty). Descendants
 * still belong to the deepest repository normally.
 */
export function gitignoreRepoRoot(repoRoots: readonly string[], absPath: string): string | null {
  const normalizedPath = absPath.replace(/\/$/, '')
  return owningRepoRoot(
    repoRoots.filter((candidate) => candidate.replace(/\/$/, '') !== normalizedPath),
    normalizedPath,
  )
}

/**
 * Build absolute-path lookups from a repo status: a file→status map and the set
 * of every ancestor directory that contains a change. Pure so it can be unit
 * tested; git paths are root-relative, resolved to absolutes to match the file
 * tree's row keys (`<root>/<...>`).
 */
export function buildTreeGitIndex(
  status: SourceControlStatus | null | undefined,
  discoveredRepoRoots: readonly string[] = status?.root ? [status.root] : [],
): TreeGitIndex {
  const repoRoots = [...new Set(discoveredRepoRoots)]
  const gitignoreRootFor = (absPath: string) => gitignoreRepoRoot(repoRoots, absPath)
  if (!status?.isRepo || !status.root || status.files.length === 0)
    return { ...EMPTY_INDEX, gitignoreRootFor }
  const root = status.root.replace(/\/$/, '')
  const files = new Map<string, RepoChangeStatus>()
  const dirs = new Set<string>()
  for (const f of status.files) {
    const abs = `${root}/${f.path}`
    files.set(abs, f.status)
    // Mark every ancestor directory up to (and including) the repo root.
    let slash = abs.lastIndexOf('/')
    while (slash > root.length - 1) {
      const dir = abs.slice(0, slash)
      if (dirs.has(dir)) break // ancestors already recorded by an earlier file
      dirs.add(dir)
      slash = dir.lastIndexOf('/')
    }
  }
  return {
    statusFor: (absPath) => files.get(absPath),
    dirHasChanges: (absPath) => dirs.has(absPath.replace(/\/$/, '')),
    dirty: true,
    gitignoreRootFor,
  }
}

/** Reactive tree git index for a session (reads the shared source-control store). */
export function useFileTreeGitStatus(sessionId: string | null): TreeGitIndex {
  // Two narrow reads instead of the slice: a stash or loading-flag write no longer rebuilds the
  // index, and the roots compare by value.
  const status = useSessionGitField(sessionId, 'status')
  const roots = useSessionRepoRoots(sessionId)
  return useMemo(() => buildTreeGitIndex(status, roots.length ? roots : undefined), [status, roots])
}

export function useGitFileTreeDecorations(sessionId: string | null): FileTreeDecorationIndex {
  const index = useFileTreeGitStatus(sessionId)
  return useMemo(
    () => ({
      decorationFor: (path: string) => {
        const status = index.statusFor(path)
        return status ? statusMeta(status) : undefined
      },
      directoryHasDecorations: index.dirHasChanges,
      ignoreLabel: 'Add to .gitignore',
      addToIgnore: async (path: string, isDirectory: boolean) => {
        if (!sessionId) return
        const root = index.gitignoreRootFor(path)
        if (!root) {
          toast.info('This path is not inside a Git repository')
          return
        }
        const relative = relativePath(root, path).replace(/^\/+/, '')
        // Caught here: the host's context menu fires this without awaiting it, so a throw used to
        // end as an unhandled rejection and the person never learned the entry was not written.
        // No success row: the path's decoration in the tree changes to ignored.
        try {
          await useSourceControlStore
            .getState()
            .addToGitignore(sessionId, [`/${relative}${isDirectory ? '/' : ''}`], root)
        } catch (err) {
          gitFailed('Could not add the path to .gitignore', err)
        }
      },
    }),
    [index, sessionId],
  )
}

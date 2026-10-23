import { useCallback, useMemo, useState } from 'react'
import type { RepoWithStatus } from '../../../backend/source-control/contracts'

/**
 * Expand/collapse state for the multi-root Source Control view. A repo is open by
 * DEFAULT when it has changes (clean repos fold away so the panel stays compact),
 * and the user can override any repo individually or flip every group at once with
 * Expand-/Collapse-all. Overrides are keyed by repo root and survive re-polls.
 */
export function useRepoCollapse(repos: RepoWithStatus[]) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  const defaultOpen = useCallback((repo: RepoWithStatus) => repo.status.files.length > 0, [])
  const isOpen = useCallback(
    (repo: RepoWithStatus) => overrides[repo.root] ?? defaultOpen(repo),
    [overrides, defaultOpen],
  )

  const toggle = useCallback(
    (repo: RepoWithStatus) =>
      setOverrides((o) => ({ ...o, [repo.root]: !(o[repo.root] ?? defaultOpen(repo)) })),
    [defaultOpen],
  )

  const setAll = useCallback(
    (open: boolean) => setOverrides(Object.fromEntries(repos.map((r) => [r.root, open]))),
    [repos],
  )

  // Enable "Expand all" only while something is collapsed, and vice-versa.
  const anyOpen = useMemo(() => repos.some((r) => isOpen(r)), [repos, isOpen])
  const anyClosed = useMemo(() => repos.some((r) => !isOpen(r)), [repos, isOpen])

  return {
    isOpen,
    toggle,
    expandAll: () => setAll(true),
    collapseAll: () => setAll(false),
    anyOpen,
    anyClosed,
  }
}

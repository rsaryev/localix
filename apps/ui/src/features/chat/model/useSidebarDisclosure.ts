import { useCallback, useState } from 'react'

/** Explicit folds survive search; navigating into a branch reveals its full path. */
export function useSidebarDisclosure() {
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({})
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({})
  const toggleParent = useCallback((id: string, isExpanded: boolean) => {
    setCollapsedParents((current) => ({ ...current, [id]: isExpanded }))
  }, [])
  const toggleBranchAll = useCallback((id: string) => {
    setExpandedBranches((current) => ({ ...current, [id]: !current[id] }))
  }, [])
  const revealPath = useCallback((ids: readonly string[]) => {
    setCollapsedParents((current) => {
      if (ids.every((id) => Object.hasOwn(current, id) && !current[id])) return current
      return { ...current, ...Object.fromEntries(ids.map((id) => [id, false])) }
    })
    setExpandedBranches((current) => {
      const parents = ids.slice(0, -1)
      if (parents.every((id) => current[id])) return current
      return { ...current, ...Object.fromEntries(parents.map((id) => [id, true])) }
    })
  }, [])
  return { collapsedParents, expandedBranches, toggleParent, toggleBranchAll, revealPath }
}

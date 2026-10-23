import { createContext, useContext, type ReactNode } from 'react'

/**
 * Is this work item the ACTIVE tab of the ACTIVE (focused) editor group?
 *
 * `useWorkItemVisible` (mini app SDK) answers a different question: a side-by-side
 * split has TWO visible bodies at once, and warm keep-alive keeps background
 * bodies mounted-but-hidden. Anything that must exist exactly once per window —
 * a status-bar contribution, a singleton side effect — needs the stricter
 * signal: only one work item in the whole grid is focused.
 *
 * Outside a provider the surface is treated as focused, so a body rendered
 * standalone (tests, an isolated preview) still behaves like the active editor.
 */
const WorkItemFocusContext = createContext(true)

export function WorkItemFocusProvider({
  focused,
  children,
}: {
  focused: boolean
  children: ReactNode
}) {
  return <WorkItemFocusContext.Provider value={focused}>{children}</WorkItemFocusContext.Provider>
}

export function useWorkItemFocused(): boolean {
  return useContext(WorkItemFocusContext)
}

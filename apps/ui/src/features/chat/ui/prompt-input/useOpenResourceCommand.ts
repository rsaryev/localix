import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ResourceNode } from '@/shared/api/contracts'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { canNavigateUi, navigateUi } from '@/shared/lib/uiNavigation'
import { useResourceDrill } from './useResourceDrill'
import { toast } from '@/shared/lib/notify'
import { useChatStore } from '@/features/chat/model/store'

export interface OpenResourceRow {
  id: string
  node: ResourceNode
  current?: boolean
}

/**
 * `/open <uri>` in one composer. `sessionId` is the composer's own chat: what `/open` reveals are
 * that chat's tabs, and the browse is scoped to its workspace. It used to read the chat on screen,
 * so a composer bound to another session (a sub-session pane, a split) opened into the wrong one.
 */
export function useOpenResourceCommand(
  sessionId: string | null,
  active: boolean,
  partial: string,
  setPrompt: (value: string) => void,
) {
  const navigation = useUiNavigation({
    sessionId,
    sessionProjectId: (id) =>
      useChatStore.getState().allSessions.find((session) => session.id === id)?.projectId ?? null,
  })
  const drill = useResourceDrill({ active, partial, includeUiAnchors: true, sessionId })
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => setActiveIndex(0), [drill.parent, drill.segment])
  const rows = useMemo<OpenResourceRow[]>(() => {
    const current =
      drill.parent && canNavigateUi(drill.parent)
        ? [
            {
              id: `open:${drill.parent}`,
              node: drill.container ?? {
                uri: drill.parent,
                label: drill.breadcrumbs.at(-1)?.label ?? drill.parent,
                hasChildren: true,
              },
              current: true,
            },
          ]
        : []
    const rows: OpenResourceRow[] = [...current]
    for (const node of drill.nodes) {
      if (!node.notice && (node.hasChildren || canNavigateUi(node.uri))) {
        rows.push({ id: node.uri, node })
      }
    }
    return rows
  }, [drill.parent, drill.container, drill.nodes, drill.breadcrumbs])

  const clampedIndex = Math.min(activeIndex, Math.max(0, rows.length - 1))
  const setParent = useCallback(
    (uri: string | null) => setPrompt(uri ? `/open ${uri}/` : '/open '),
    [setPrompt],
  )
  const accept = useCallback(
    (row: OpenResourceRow) => {
      if (row.current || !row.node.hasChildren) {
        if (navigateUi(row.node.uri, navigation)) setPrompt('')
        else
          toast.error(`Could not open “${row.node.label}”`, {
            description: 'Nothing in the app can show this resource.',
          })
        return
      }
      setParent(row.node.uri)
    },
    [navigation, setParent, setPrompt],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (!active) return false
      if (event.key === 'Escape') {
        event.preventDefault()
        setPrompt('')
        return true
      }
      if (event.key === 'ArrowDown' && rows.length > 0) {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % rows.length)
        return true
      }
      if (event.key === 'ArrowUp' && rows.length > 0) {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + rows.length) % rows.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const row = rows[clampedIndex] ?? rows[0]
        event.preventDefault()
        if (row) accept(row)
        return true
      }
      return false
    },
    [accept, active, clampedIndex, rows, setPrompt],
  )

  return {
    ...drill,
    rows,
    activeIndex: clampedIndex,
    setActiveIndex,
    accept,
    setParent,
    handleKeyDown,
    submit: () => {
      const row = rows[clampedIndex] ?? rows[0]
      if (row) accept(row)
    },
  }
}

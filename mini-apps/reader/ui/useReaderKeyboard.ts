import { useId, type RefObject } from 'react'
import { useFocusEntry } from '@localixai/mini-app-sdk/ui/focus'
import { matchesChord } from '@localixai/kit/keybindings'

import type { ReaderPreferences } from './model'

/** The reading surface's shortcuts, active while this pane is visible and keyboard-owning. */
export function useReaderKeyboard({
  workspaceRef,
  panelToggleRef,
  active,
  speedReadingOpen,
  viewMode,
  autoScrollActive,
  panelOpen,
  narrowPane,
  hasSelection,
  openSearch,
  startAutoScroll,
  stopAutoScroll,
  toggleAutoScrollPause,
  closePanel,
  clearSelection,
  moveNavigationHistory,
  turnReadingPosition,
}: {
  workspaceRef: RefObject<HTMLDivElement | null>
  panelToggleRef: RefObject<HTMLButtonElement | null>
  active: boolean
  speedReadingOpen: boolean
  viewMode: ReaderPreferences['viewMode']
  autoScrollActive: boolean
  panelOpen: boolean
  narrowPane: boolean
  hasSelection: boolean
  openSearch: () => void
  startAutoScroll: () => void
  stopAutoScroll: () => void
  toggleAutoScrollPause: () => void
  closePanel: () => void
  clearSelection: () => void
  moveNavigationHistory: (direction: 'back' | 'forward') => void
  turnReadingPosition: (direction: -1 | 1) => void
}) {
  const keyboardId = useId()
  useFocusEntry({
    id: `reader:${keyboardId}`,
    kind: 'surface',
    active,
    scope: () => workspaceRef.current,
    onKeyDown: (event) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
        return
      if (target?.closest('[role=menu],[role=dialog],[role=listbox],[role=tree]')) return
      if (speedReadingOpen) return
      if (matchesChord(event, 'mod+f')) {
        event.preventDefault()
        openSearch()
        return
      }
      if (matchesChord(event, 'shift+a')) {
        if (viewMode !== 'scroll') return
        event.preventDefault()
        if (autoScrollActive) stopAutoScroll()
        else startAutoScroll()
        return
      }
      if (autoScrollActive && matchesChord(event, 'space')) {
        event.preventDefault()
        toggleAutoScrollPause()
        return
      }
      if (autoScrollActive && matchesChord(event, 'escape')) {
        event.preventDefault()
        stopAutoScroll()
        return
      }
      if (matchesChord(event, 'escape') && panelOpen && narrowPane) {
        event.preventDefault()
        closePanel()
        panelToggleRef.current?.focus({ preventScroll: true })
        return
      }
      if (matchesChord(event, 'escape') && hasSelection) {
        event.preventDefault()
        clearSelection()
        return
      }
      const historyDirection =
        matchesChord(event, 'alt+arrowleft') || matchesChord(event, 'mod+[')
          ? 'back'
          : matchesChord(event, 'alt+arrowright') || matchesChord(event, 'mod+]')
            ? 'forward'
            : null
      if (historyDirection) {
        event.preventDefault()
        moveNavigationHistory(historyDirection)
        return
      }
      if (!matchesChord(event, 'arrowleft') && !matchesChord(event, 'arrowright')) return
      event.preventDefault()
      turnReadingPosition(event.key === 'ArrowLeft' ? -1 : 1)
    },
  })
}

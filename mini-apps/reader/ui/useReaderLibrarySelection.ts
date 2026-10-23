import { useCallback, useEffect, useId, useState, type RefObject } from 'react'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'

import { toggleKey, toggleShelfSelection } from './libraryPaneModel'

/** Multi-select over the book gallery; Escape leaves it while the library owns the keyboard. */
export function useReaderLibrarySelection({
  keyboardRoot,
  view,
}: {
  keyboardRoot: RefObject<HTMLDivElement | null>
  view: 'books' | 'saved'
}) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedBookKeys, setSelectedBookKeys] = useState<Set<string>>(() => new Set())
  const keyboardId = useId()

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedBookKeys(new Set())
  }, [])

  useEffect(() => {
    if (view === 'books') return
    exitSelection()
  }, [exitSelection, view])

  useFocusEntry({
    id: `reader-library:${keyboardId}`,
    kind: 'surface',
    active: selectionMode,
    scope: () => keyboardRoot.current,
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      exitSelection()
      return true
    },
  })

  const toggleSelectionMode = () => {
    setSelectionMode((current) => !current)
    setSelectedBookKeys(new Set())
  }

  /** Toggles one book, entering selection mode if it was off. */
  const toggleBook = (key: string) => {
    setSelectionMode(true)
    setSelectedBookKeys((current) => toggleKey(current, key))
  }

  const toggleShelf = (visibleKeys: string[]) => {
    setSelectedBookKeys((current) => toggleShelfSelection(current, visibleKeys))
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedBookKeys,
    setSelectedBookKeys,
    exitSelection,
    toggleSelectionMode,
    toggleBook,
    toggleShelf,
  }
}

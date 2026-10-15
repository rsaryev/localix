import { useEffect, useState } from 'react'

import type { ReaderSidePanel } from './readerPaneModel'
import type { ReaderPanelSelection } from './ReaderPanelBody'

/**
 * The book panel's own state: whether it is open, which tab, and which entry in each tab is
 * current. Held by the pane rather than the panel so it survives the panel closing.
 */
export function useReaderPanelState({
  initialChapter,
  chapterIndex,
  collapsed,
}: {
  initialChapter: number | undefined
  chapterIndex: number
  /** A compact or narrow pane starts, and stays, with the panel closed. */
  collapsed: boolean
}) {
  const [sidePanel, setSidePanel] = useState<ReaderSidePanel>('toc')
  const [panelOpen, setPanelOpen] = useState(true)
  const [searchMatchId, setSearchMatchId] = useState<string | null>(null)
  const [tocFocusIndex, setTocFocusIndex] = useState(initialChapter ?? 0)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)

  useEffect(() => {
    if (collapsed) setPanelOpen(false)
  }, [collapsed])

  useEffect(() => setTocFocusIndex(chapterIndex), [chapterIndex])

  const selection: ReaderPanelSelection = {
    searchMatchId,
    setSearchMatchId,
    tocFocusIndex,
    setTocFocusIndex,
    activeAnnotationId,
    setActiveAnnotationId,
    editingAnnotationId,
    setEditingAnnotationId,
  }
  return {
    sidePanel,
    setSidePanel,
    panelOpen,
    setPanelOpen,
    selection,
    openSidePanel: (panel: ReaderSidePanel) => {
      setPanelOpen(true)
      setSidePanel(panel)
    },
  }
}

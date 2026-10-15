import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  findCatalogModelForConnection,
  type CatalogModel,
  type CatalogModelConnection,
  type ProviderEntry,
} from '@localixai/agent/catalog'
import { modelRefFromCmdkValue } from './cmdkHighlight'

/** How long the pointer must rest on a row before the details panel follows it. */
const HOVER_INTENT_MS = 150

interface ModelRef {
  connectionId: string
  modelId: string
}

export interface ModelHoverDetails {
  detailsPinned: boolean
  setDetailsPinned: (pinned: boolean | ((v: boolean) => boolean)) => void
  /** Model whose details the side panel shows: hovered row, else keyboard-highlighted row, else selected value. */
  detailModel: CatalogModel | null
  detailConnectionId: string | null
  detailProviderDoc: ProviderEntry['doc'] | undefined
  /** Whether the detail side-panel should be visible (pinned, actively hovered, or keyboard-navigating). */
  showDetails: boolean
  /** Debounced hide so moving the cursor row → panel doesn't flicker it shut. */
  scheduleHideHover: () => void
  cancelHideHover: () => void
  /** Pointer entered a model row — takes over from any keyboard highlight. */
  handleModelMouseEnter: (connectionId: string, modelId: string) => void
  /** User pressed an arrow to navigate the list — hand the panel to the keyboard highlight. */
  armKeyboardNav: () => void
  /** Report cmdk's currently-highlighted value (fed by the CmdkHighlightWatcher). */
  reportHighlight: (value: string | undefined) => void
  /** Drop both hover + keyboard follow (panel close button / view switch). */
  clearFollow: () => void
}

/**
 * Hover- AND keyboard-driven model detail panel state for the picker: tracks the
 * hovered / keyboard-highlighted / pinned model, derives the model + provider doc
 * to show, and debounces the row→panel transition. Keyboard follow is armed by an
 * arrow keypress and fed cmdk's live highlight; a pointer entering a row hands
 * control back to the mouse. Extracted so the component owns selection, not the
 * preview affordance.
 */
export function useModelHoverDetails(
  value: string,
  valueConnectionId: string | null | undefined,
  previewConnectionId: string | null | undefined,
  models: CatalogModel[],
  connections: CatalogModelConnection[],
  allProviders: ProviderEntry[],
): ModelHoverDetails {
  const [hoveredModel, setHoveredModel] = useState<ModelRef | null>(null)
  // Model id the keyboard highlight currently points at (null = not keyboard-following).
  const [kbdModel, setKbdModel] = useState<ModelRef | null>(null)
  // Open by default. A panel that appeared on hover and vanished on leave resized the model
  // list under the pointer on every pass, so the rows jumped sideways while being read. Kept
  // open, it only changes CONTENT — hovered model, else the current one — never the layout.
  const [detailsPinned, setDetailsPinned] = useState(true)
  // Only follow cmdk's highlight after the user actually arrows the list — cmdk
  // auto-highlights the first row on open, which must NOT force the panel open.
  const kbdArmedRef = useRef(false)
  // Debounce timer so moving cursor from model row → detail panel doesn't flicker.
  const hoverLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hover INTENT: a row takes the panel only once the pointer rests on it. Crossing rows on the
  // way to the panel's controls must not swap the model under the control being reached for.
  const hoverEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimers = useCallback(() => {
    if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current)
    if (hoverEnterTimer.current) clearTimeout(hoverEnterTimer.current)
  }, [])

  const scheduleHideHover = useCallback(() => {
    clearTimers()
    // While the panel is pinned it keeps the last model shown: leaving the list toward the
    // panel must not snap it back to the current model.
    if (detailsPinned) return
    hoverLeaveTimer.current = setTimeout(() => setHoveredModel(null), 120)
  }, [clearTimers, detailsPinned])
  const cancelHideHover = clearTimers

  const handleModelMouseEnter = useCallback(
    (connectionId: string, modelId: string) => {
      clearTimers()
      hoverEnterTimer.current = setTimeout(() => {
        kbdArmedRef.current = false
        setKbdModel(null)
        setHoveredModel({ connectionId, modelId })
      }, HOVER_INTENT_MS)
    },
    [clearTimers],
  )

  const armKeyboardNav = useCallback(() => {
    kbdArmedRef.current = true
    clearTimers()
    setHoveredModel(null)
  }, [clearTimers])

  const reportHighlight = useCallback(
    (cmdkValue: string | undefined) => {
      if (!kbdArmedRef.current) return
      const ref = modelRefFromCmdkValue(cmdkValue)
      const connectionId = ref?.connectionId ?? previewConnectionId
      setKbdModel(ref && connectionId ? { connectionId, modelId: ref.modelId } : null)
    },
    [previewConnectionId],
  )

  const clearFollow = useCallback(() => {
    kbdArmedRef.current = false
    clearTimers()
    setHoveredModel(null)
    setKbdModel(null)
  }, [clearTimers])

  const detailRef =
    hoveredModel ??
    kbdModel ??
    (valueConnectionId && value ? { connectionId: valueConnectionId, modelId: value } : null)
  const detailConnectionId = detailRef?.connectionId ?? null
  const detailModel = useMemo(() => {
    return detailRef
      ? (findCatalogModelForConnection(
          models,
          connections,
          detailRef.connectionId,
          detailRef.modelId,
        ) ?? null)
      : null
  }, [connections, detailRef, models])

  const detailProviderDoc = useMemo(
    () =>
      detailModel ? allProviders.find((p) => p.id === detailModel.providerId)?.doc : undefined,
    [detailModel, allProviders],
  )

  const showDetails = detailsPinned || hoveredModel !== null || kbdModel !== null

  useEffect(() => clearTimers, [clearTimers])

  return {
    detailsPinned,
    setDetailsPinned,
    detailModel,
    detailConnectionId,
    detailProviderDoc,
    showDetails,
    scheduleHideHover,
    cancelHideHover,
    handleModelMouseEnter,
    armKeyboardNav,
    reportHighlight,
    clearFollow,
  }
}

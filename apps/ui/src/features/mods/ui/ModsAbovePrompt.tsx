import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { modsApi } from '@/shared/api/modsApi'
import { ModBand } from './ModBand'

/**
 * The conversation's band above its prompt box (Claude Code's `AbovePrompt` site), in the
 * composer's header stack. Drawn for the focused composer only, at the width it has: a mod reads
 * it as `e.props.bodyColumns`. Re-read on the `mods` poke; nothing shows while no mod draws.
 */

/** Rows the band may take (`e.props.maxRows`): the room above the prompt box. */
const BAND_ROWS = 12
/** About one monospace cell of the app's text, for the columns a mod lays its band out in. */
const CELL_PX = 8

function useColumns() {
  const ref = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(100)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      // Ten cells a step, so a resize redraws the band only when a mod could see it.
      if (width > 0) setColumns(Math.max(20, Math.floor(width / CELL_PX / 10) * 10))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, columns }
}

export function ModsAbovePrompt({
  sessionId,
  context,
}: {
  sessionId: string | null
  context?: { isFocused?: boolean }
}) {
  const { ref, columns } = useColumns()
  const live = sessionId !== null && context?.isFocused !== false
  const key = live ? `mod-band:${sessionId}:${columns}` : null
  useRevalidateOnResources(key ?? 'mod-band:none', ['mods'])
  const { data } = useSWR(key, () => modsApi.band(sessionId!, columns, BAND_ROWS))
  return (
    <div ref={ref}>
      {sessionId && data?.tree ? (
        <ModBand
          tree={data.tree}
          act={(action) =>
            runMiniAppAction(() => modsApi.bandAct(sessionId, action), 'The mod did not take that')
          }
        />
      ) : null}
    </div>
  )
}

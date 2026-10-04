import { useCallback, useState } from 'react'
import { useCanvasCamera } from '@localixai/kit/canvas'
import type { SpaceDocument } from '../../shared/format/document'
import { newId, takenIn } from '../../shared/format/ids'
import type { SpaceOp } from '../../shared/ops/contract'
import { INSERTABLE } from '../elements'
import { placementOf } from './placement'

/**
 * The board's tools, as the design tools have them: Select and Hand, and one tool per type a
 * person makes from nothing. Arming a tool and clicking the ground places that element there; the
 * board then returns to Select, unless the tool is locked (Q), for placing a row of notes. A text
 * type opens for typing the moment it lands.
 */
export type Tool = 'select' | 'hand' | (string & {})

export function useTools(deps: {
  space: SpaceDocument
  commit: (ops: readonly SpaceOp[]) => void
  select: (ids: Iterable<string>) => void
  setEditing: (id: string | null) => void
}) {
  const camera = useCanvasCamera()
  const [tool, setActiveTool] = useState<Tool>('select')
  const [toolProps, setToolProps] = useState<Record<string, unknown> | undefined>()
  const [locked, setLocked] = useState(false)
  const setTool = useCallback((next: Tool, props?: Record<string, unknown>) => {
    setActiveTool(next)
    setToolProps(props)
  }, [])

  /** Place the armed type at a screen point; false when no type is armed. */
  const placeAt = useCallback(
    (clientX: number, clientY: number) => {
      const placement = placementOf(tool, toolProps)
      if (!placement || placement.view.insert?.gesture === 'draw') return false
      const { view, spec, size, props } = placement
      const at = camera.toBoard(clientX, clientY)
      const id = newId(takenIn(deps.space))
      deps.commit([
        {
          op: 'create',
          type: tool,
          id,
          x: Math.round(at.x - size.w / 2),
          y: Math.round(at.y - size.h / 2),
          props,
        },
      ])
      deps.select([id])
      if (view.editable && spec.textProp) deps.setEditing(id)
      if (!locked) setTool('select')
      return true
    },
    [camera, deps, locked, tool, toolProps, setTool],
  )

  /** A tool key: V, H, Q, Escape, or an insertable type's own letter. */
  const onToolKey = useCallback(
    (key: string): boolean => {
      if (key === 'v') setTool('select')
      else if (key === 'h') setTool('hand')
      else if (key === 'q') setLocked((current) => !current)
      else if (key === 'escape' && tool !== 'select') setTool('select')
      else {
        const view = INSERTABLE.find((candidate) => candidate.insert?.key === key)
        if (!view) return false
        setTool(view.type)
      }
      return true
    },
    [tool, setTool],
  )

  return { tool, toolProps, setTool, locked, setLocked, placeAt, onToolKey }
}

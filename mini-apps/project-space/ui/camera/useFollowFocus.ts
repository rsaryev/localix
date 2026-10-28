import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useCanvasCamera } from '@localixai/kit/canvas'
import { subjectOf } from '../../shared/camera-target'
import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import { boundsOfBoxes } from '../../shared/ops/layout'
import { focusViewport } from './framing'
import type { CameraDirector } from './useCameraDirector'
import { keepInView } from './keepInView'
import { isAddedFocus } from './useAddedFocus'

/**
 * The camera and the focus — the element or elements selected.
 *
 * A DELIBERATE focus (a click on an element, Tab, a pick in the layers panel — the caller says so
 * with `intend()`) takes the camera to it: brought to a reading size, a frame fitted whole, never
 * pulled back from what is already read closer (`focusViewport`). It is a jump, so ⌥← undoes it.
 * It waits out a double-click first: flown on the first click, the element would be somewhere
 * else by the second, and a double-click to edit would miss it.
 *
 * Any OTHER change of the focus — a drag-select, the agent moving or growing what you look at —
 * only keeps it in view, sliding the least it can (`keepInView`), and is not remembered.
 *
 * Nothing moves while a drag or a resize is on screen (the library pans at the edges then) or
 * while an element is being edited. The question is keyed by the focus's ids and boxes, so a poll
 * that changed nothing asks nothing.
 */
const MARGIN_PX = 56
/** Longer than a double-click's gap, so the second click lands where the first one did. */
const DOUBLE_CLICK_MS = 280

export function useFollowFocus(
  selected: ReadonlySet<string>,
  space: SpaceDocument,
  director: CameraDirector,
  still: { busy: boolean; editing: string | null },
): { intend: () => void } {
  const camera = useCanvasCamera()
  const ids = [...selected].filter((id) => space.elements[id])
  const boxes = ids.map((id) => space.elements[id] as SpaceElement)
  const key = ids
    .map((id, index) => {
      const box = boxes[index] as SpaceElement
      return `${id}:${box.x},${box.y},${box.w},${box.h}`
    })
    .join('|')
  // The effect answers a change of the key, but reads everything else as it is by then.
  const latest = useEffectEvent(() => ({ ids, boxes, space, director, still }))
  const intent = useRef(false)
  // A click on the element that already has the focus changes no selection, and must still go
  // there: the intent itself is a change the effect answers.
  const [asked, setAsked] = useState(0)
  const intend = useCallback(() => {
    intent.current = true
    setAsked((count) => count + 1)
  }, [])

  useEffect(() => {
    const deliberate = intent.current
    intent.current = false
    const go = () => {
      const { ids: focused, boxes: focus, space: board, director: guide, still: now } = latest()
      if (!key || now.busy || now.editing || focus.length === 0) return
      const size = guide.size()
      if (!size) return
      const rect = boundsOfBoxes(focus)
      if (!deliberate) {
        // Selecting a chat addition re-renders during its framing flight. A second glide here
        // would cancel that flight and leave the new fragment outside the reading viewport.
        if (focused.every(isAddedFocus)) return
        const next = keepInView(rect, camera.get(), size, MARGIN_PX)
        if (next) void guide.glide(next)
        return
      }
      const next = focusViewport(rect, subjectOf(board, focused), camera.get(), size)
      if (next) void guide.jump(next)
    }
    if (!deliberate) return go()
    const timer = window.setTimeout(go, DOUBLE_CLICK_MS)
    return () => window.clearTimeout(timer)
  }, [asked, camera, key])

  return { intend }
}

import type { RefObject } from 'react'
import { useCameraPlacement, useCanvasCamera } from '@localixai/kit/canvas'
import type { SpaceElement } from '../../shared/format/document'
import { visibleRect } from '../../shared/camera'
import { subjectOf } from '../../shared/camera-target'
import { contains } from '../../shared/ops/geometry'
import { boundsOfBoxes } from '../../shared/ops/layout'
import type { RemoteChange } from '../useSpace'
import { selectionViewport } from './framing'
import { useAddedFocus } from './useAddedFocus'
import { useCameraBridge } from './useCameraBridge'
import { useCameraDirector } from './useCameraDirector'
import { useFollow } from './useFollow'
import { useFollowFocus } from './useFollowFocus'
import type { SpaceView } from '../../shared/api'

/**
 * The board's camera, whole: the one place the board asks for it, so the parts of it — who moves
 * it and why — are composed once instead of wired one by one through the board component.
 *
 * - its FIRST look fits the board; after that the camera is the person's;
 * - the DIRECTOR takes every deliberate trip (flown, remembered, lit up);
 * - the BRIDGE lets the agent's `space_view` move it;
 * - it FOLLOWS the focus (to a deliberate one, keeping any other in view) and the changes
 *   someone else makes (shown, counted, or followed).
 */
export interface BoardCameraInput {
  root: RefObject<HTMLElement | null>
  sessionId: string
  /** The board, and whether the backend streams it (`liveUpdates`): the agent's moves arrive then. */
  view: Pick<SpaceView, 'space' | 'liveUpdates'>
  remote: RemoteChange | null
  selected: ReadonlySet<string>
  select: (ids: Iterable<string>) => void
  /** A drag or a resize on screen, or an element being edited: the camera keeps still. */
  still: { busy: boolean; editing: string | null }
  /** The agent showed these elements with `space_view`. */
  onAgentShown: (ids: readonly string[]) => void
}

export function useBoardCamera(input: BoardCameraInput) {
  const { root, sessionId, view, remote, selected, select, still, onAgentShown } = input
  const { space } = view
  const live = view.liveUpdates === true
  const camera = useCanvasCamera()
  // The board is not hidden while its first placement waits: one frame at the default camera
  // costs a whiteboard nothing, and a surface that never reports a size (the agent's capture of
  // the tab) must still see the board.
  useCameraPlacement(sessionId, () => camera.fit())
  const director = useCameraDirector(root)
  useCameraBridge(sessionId, director, onAgentShown, { live })
  useAddedFocus(sessionId, space, director, select, root)
  const follow = useFollow(remote, space, director, root)
  const focus = useFollowFocus(selected, space, director, still)

  /** Select as a DELIBERATE focus: the camera takes the person there. */
  const focusOn = (ids: Iterable<string>) => {
    focus.intend()
    select(ids)
  }

  /** Shift+2: two-step zoom to selection — 100 %, then the whole of it. */
  const toSelection = () => {
    const ids = [...selected].filter((id) => space.elements[id])
    const size = director.size()
    if (ids.length === 0 || !size) return false
    const rect = boundsOfBoxes(ids.map((id) => space.elements[id] as SpaceElement))
    void director.jump(selectionViewport(rect, size, camera.get()), ids)
    return true
  }

  /**
   * Bring elements into view WITHOUT selecting them — what a trace found. Already on screen, the
   * camera keeps still: a person reading a trace in place is not moved for nothing.
   */
  const reveal = (ids: readonly string[]) => {
    const live = ids.filter((id) => space.elements[id])
    const size = director.size()
    if (live.length === 0 || !size) return
    const rect = boundsOfBoxes(live.map((id) => space.elements[id] as SpaceElement))
    if (contains(visibleRect({ viewport: camera.get(), size }), rect)) return
    void director.frame(rect, subjectOf(space, live))
  }

  return {
    director,
    follow,
    intend: focus.intend,
    focusOn,
    reveal,
    keys: { back: () => director.back(), forward: () => director.forward(), toSelection },
  }
}

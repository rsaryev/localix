import { useEffect, useRef, useState, type RefObject } from 'react'
import { useCanvasCamera } from '@localixai/kit/canvas'
import { visibleRect } from '../../shared/camera'
import { subjectOf } from '../../shared/camera-target'
import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import { contains } from '../../shared/ops/geometry'
import { boundsOfBoxes } from '../../shared/ops/layout'
import type { RemoteChange } from '../useSpace'
import { isAddedFocus } from './useAddedFocus'
import type { CameraDirector } from './useCameraDirector'

/**
 * The camera and the agent working on the same board.
 *
 * What someone else changed (`useSpace`'s `remote`) is SHOWN, never silently: a change already
 * on screen glows where it is; one off screen either takes the camera there — while the person
 * follows — or waits in a count ("3 changes · Show") until they ask. Following ends the moment
 * the person moves the camera themselves: a camera that pulled
 * away mid-gesture would be a camera nobody owns.
 */
export interface Follow {
  following: boolean
  setFollowing: (on: boolean) => void
  /** Changes off screen the person has not looked at yet. */
  unseen: string[]
  showUnseen: () => void
}

export function useFollow(
  remote: RemoteChange | null,
  space: SpaceDocument,
  director: CameraDirector,
  root: RefObject<HTMLElement | null>,
): Follow {
  const camera = useCanvasCamera()
  const [following, setFollowing] = useState(false)
  const [unseen, setUnseen] = useState<string[]>([])
  const board = useRef({ space, director, following })
  board.current = { space, director, following }

  // The person's own hand on the camera ends following — the wheel, a pinch, or a press on the
  // board (a pan with Space or the hand, a drag, the minimap) — as it ends a flight. Not a press on
  // the camera's own chips: it would stop following just before the click that toggles it.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const stop = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.('.space-chip')) setFollowing(false)
    }
    element.addEventListener('wheel', stop, { passive: true })
    element.addEventListener('gesturestart', stop)
    element.addEventListener('pointerdown', stop)
    return () => {
      element.removeEventListener('wheel', stop)
      element.removeEventListener('gesturestart', stop)
      element.removeEventListener('pointerdown', stop)
    }
  }, [root])

  useEffect(() => {
    if (!remote) return
    const { space: now, director: guide, following: on } = board.current
    // What the person just added from a chat is focused by `useAddedFocus`, not shown twice.
    const ids = remote.ids.filter((id) => now.elements[id] && !isAddedFocus(id))
    const size = guide.size()
    if (ids.length === 0 || !size) return
    const rect = boundsOfBoxes(ids.map((id) => now.elements[id] as SpaceElement))
    if (contains(visibleRect({ viewport: camera.get(), size }), rect)) return guide.spotlight(ids)
    if (on) {
      void guide.frame(rect, subjectOf(now, ids), { spotlight: ids })
      return
    }
    setUnseen((current) => [...new Set([...current, ...ids])])
  }, [camera, remote])

  const showUnseen = () => {
    const ids = unseen.filter((id) => space.elements[id])
    setUnseen([])
    if (ids.length === 0) return
    const rect = boundsOfBoxes(ids.map((id) => space.elements[id] as SpaceElement))
    void director.frame(rect, subjectOf(space, ids), { spotlight: ids })
  }

  return {
    following,
    setFollowing: (on) => {
      setFollowing(on)
      if (on) showUnseen()
    },
    unseen,
    showUnseen,
  }
}

import { useEffect, useEffectEvent, useState, useSyncExternalStore, type RefObject } from 'react'
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

/**
 * The ids changed off screen that the person has not looked at. What the camera sees when a change
 * arrives is an outside fact, so the list is a small store the effect writes to, not a state it sets.
 */
function createUnseen() {
  let ids: string[] = []
  const listeners = new Set<() => void>()
  const publish = (next: string[]) => {
    ids = next
    for (const listener of listeners) listener()
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => ids,
    add: (more: readonly string[]) => publish([...new Set([...ids, ...more])]),
    clear: () => publish([]),
  }
}

export function useFollow(
  remote: RemoteChange | null,
  space: SpaceDocument,
  director: CameraDirector,
  root: RefObject<HTMLElement | null>,
): Follow {
  const camera = useCanvasCamera()
  const [following, setFollowing] = useState(false)
  const [offscreen] = useState(createUnseen)
  const unseen = useSyncExternalStore(offscreen.subscribe, offscreen.get)
  const latest = useEffectEvent(() => ({ space, director, following }))

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
    const { space: now, director: guide, following: on } = latest()
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
    offscreen.add(ids)
  }, [camera, remote, offscreen])

  const showUnseen = () => {
    const ids = unseen.filter((id) => space.elements[id])
    offscreen.clear()
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

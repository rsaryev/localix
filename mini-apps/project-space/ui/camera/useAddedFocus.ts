import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import { subjectOf } from '../../shared/camera-target'
import { boundsOfBoxes } from '../../shared/ops/layout'
import type { CameraDirector } from './useCameraDirector'

/**
 * WHAT THE PERSON JUST PUT ON THE BOARD FROM ELSEWHERE — a chat's "Add to Project Space" — is
 * where the board opens: flown to, lit up and selected, exactly once.
 *
 * The defect it stops: an added element landed at whatever free spot the layout found, often off
 * screen, and the board gave no sign of it. A camera move sent through the server's camera hub
 * was the wrong carrier: the hub replays its last move to any tab that mounts within seconds,
 * so after a delete and a re-add the camera flew to where the deleted element had been, and that
 * flight raced the board's own glow for a remote change. Here the request lives in this module,
 * the same one the action and the board load. The board TAKES it when the element is in its
 * document, so a remount cannot replay it, and `useFollow` leaves those ids alone.
 */
const FRESH_MS = 10_000
const PENDING_MS = 60_000
/** A tab this add just opened places its camera first; a flight before that would be undone. */
const PLACEMENT_MS = 450

const pending = new Map<string, { ids: string[]; at: number }>()
const claimed = new Map<string, number>()
const listeners = new Set<() => void>()

/** Ask the chat's board to focus these elements once they are on it. */
export function requestAddedFocus(sessionId: string, ids: readonly string[]) {
  const now = Date.now()
  for (const [id, request] of pending) {
    if (now - request.at > PENDING_MS) pending.delete(id)
  }
  for (const [id, at] of claimed) {
    if (now - at > FRESH_MS) claimed.delete(id)
  }
  const previous = pending.get(sessionId)
  pending.set(sessionId, { ids: [...new Set([...(previous?.ids ?? []), ...ids])], at: now })
  for (const listener of listeners) listener()
}

/** Ids this board focuses (or is about to): a remote-change glow for them would be a second show. */
export function isAddedFocus(id: string): boolean {
  const now = Date.now()
  const at = claimed.get(id)
  if (at !== undefined && now - at < FRESH_MS) return true
  return [...pending.values()].some(
    (request) => now - request.at < PENDING_MS && request.ids.includes(id),
  )
}

export function useAddedFocus(
  sessionId: string,
  space: SpaceDocument,
  director: CameraDirector,
  select: (ids: Iterable<string>) => void,
  root: RefObject<HTMLElement | null>,
) {
  const [mounted] = useState(() => Date.now())
  // The request is taken against the board as it is by then, without restarting the watch.
  const latest = useEffectEvent(() => ({ space, director, select }))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const take = () => {
      const request = pending.get(sessionId)
      if (!request) return
      if (Date.now() - request.at > PENDING_MS) {
        pending.delete(sessionId)
        return
      }
      const { space: now, director: guide, select: pick } = latest()
      const ids = request.ids.filter((id) => now.elements[id])
      // Not in this document yet: the poll that brings it re-renders the board, and takes it then.
      if (ids.length === 0 || !guide.size()) return
      const settling = PLACEMENT_MS - (Date.now() - mounted)
      if (settling > 0) {
        clearTimeout(timer)
        timer = setTimeout(take, settling)
        return
      }
      const remaining = request.ids.filter((id) => !now.elements[id])
      if (remaining.length) pending.set(sessionId, { ...request, ids: remaining })
      else pending.delete(sessionId)
      for (const id of ids) claimed.set(id, Date.now())
      pick(ids)
      const rect = boundsOfBoxes(ids.map((id) => now.elements[id] as SpaceElement))
      void guide.frame(rect, subjectOf(now, ids), { spotlight: ids })
    }
    take()
    listeners.add(take)
    // A hidden tab can get its size without a new document. Retry when it becomes drawable.
    const observer = new ResizeObserver(take)
    if (root.current) observer.observe(root.current)
    return () => {
      listeners.delete(take)
      observer.disconnect()
      clearTimeout(timer)
    }
    // `space` re-runs it: the element arriving in the document is what it waits for.
  }, [sessionId, space, root, mounted])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpaceDocument } from '../../shared/format/document'
import { elementName } from '../../shared/graph/names'
import { spaceTypes } from '../../shared/types'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import type { RemoteChange } from '../useSpace'

/**
 * What the board says out loud, for a person who cannot see it change.
 *
 * The board changes without the person's hand in three ways — the agent edits it, the agent moves
 * the camera to show something, a trace lights part of it — and each was silent to a screen
 * reader: the glow, the flight and the dimming are all visual. One polite live region reads a
 * sentence for each. Polite, so it never cuts off what the person is reading; one region, so two
 * announcements queue instead of talking over each other.
 */
const NAMED = 3

export function namesOf(space: SpaceDocument, ids: readonly string[]): string {
  const live = ids.filter((id) => space.elements[id])
  const names = live.slice(0, NAMED).map((id) => elementName(space, spaceTypes, id, 40))
  const more = live.length - names.length
  return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ')
}

export function useAnnouncer() {
  const [message, setMessage] = useState('')
  // A repeated sentence is not a change, so a screen reader would stay quiet: a zero-width
  // space toggled at its end makes the same words a new announcement.
  const flip = useRef(false)
  const announce = useCallback((text: string) => {
    flip.current = !flip.current
    setMessage(flip.current ? text : `${text}​`)
  }, [])
  return { message, announce }
}

/** The changes someone else made, and a trace's result, read out as they happen. */
export function useBoardAnnouncements(
  space: SpaceDocument,
  remote: RemoteChange | null,
  trace: string | null,
  announce: (text: string) => void,
) {
  const board = useLatest(space)
  useEffect(() => {
    if (!remote) return
    const names = namesOf(board.current, remote.ids)
    if (names) announce(`Changed on the board: ${names}.`)
  }, [announce, remote, board])
  useEffect(() => {
    if (trace) announce(`${trace}.`)
  }, [announce, trace])
}

export function Announcer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}

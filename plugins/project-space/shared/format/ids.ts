/**
 * Element and connector ids: short enough for the agent to say back (`k3f9`, not a UUID), drawn
 * from an alphabet without the look-alikes `0 o 1 l`, so an id read off a screenshot or typed by
 * hand is the id that exists. Elements and connectors share one namespace, which is what lets
 * one `delete` operation take either.
 */
import type { SpaceDocument } from './document'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function newId(taken: (id: string) => boolean, random: () => number = Math.random): string {
  for (let attempt = 0; ; attempt++) {
    // Four characters give ~10⁶ ids; a board this crowded grows the id instead of looping.
    const length = 4 + Math.floor(attempt / 16)
    let id = ALPHABET[Math.floor(random() * 24)] as string // a letter first: never parsed as a number
    while (id.length < length) id += ALPHABET[Math.floor(random() * ALPHABET.length)]
    if (!taken(id)) return id
  }
}

/**
 * Every id a board already uses, as a check: elements and connectors (one namespace), records
 * kept raw because they could not be read, and group ids. The one answer a new id is tested
 * against, on either side — the view made ids against elements and connectors alone, so the
 * server (which also counts raw records and groups) could refuse an id the view had chosen.
 */
export function takenIn(space: SpaceDocument): (id: string) => boolean {
  const groups = new Set(Object.values(space.elements).flatMap((element) => element.groups ?? []))
  return (id) =>
    id in space.elements ||
    id in space.edges ||
    id in space.raw.elements ||
    id in space.raw.edges ||
    groups.has(id)
}

/** Whether a string could be an id this board wrote or a person typed. */
export const isSpaceId = (value: string) => /^[a-z][a-z0-9_-]{0,47}$/iu.test(value)

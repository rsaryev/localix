/**
 * A stable visual identity derived from a name — no storage, no round trip.
 *
 * An agent's avatar has to be the same everywhere it appears and the same after a restart,
 * on any machine, for a record that may have arrived as a file. Deriving it from the handle
 * gives all of that for free; storing it would mean a column that can disagree with itself
 * across two installs of the same agent.
 */

/**
 * FNV-1a, 32-bit.
 *
 * Chosen for being fully specified: the same string gives the same number in every engine
 * and every version, which a hash built out of `charCodeAt` arithmetic and bit shifts does
 * not guarantee once numbers leave the 32-bit range. `Math.imul` keeps the multiply exact.
 */
export function avatarHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  // `>>> 0` because the imul chain leaves a signed 32-bit value, and a negative seed would
  // make every downstream modulo lopsided.
  return hash >>> 0
}

/** Word boundaries a display name may use. */
const SEPARATORS = /[\s\-_./:]+/

/**
 * One or two letters, by the rule people already expect from a contact list: the initials of
 * the first two words, or the first two letters of a single word.
 *
 * `localix` reads as LO and `Code reviewer` as CR. Deliberately NOT "first letter only": a
 * roster of one-letter tiles distinguishes agents by colour alone, and colour is the thing a
 * colour-blind reader loses.
 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(SEPARATORS).filter(Boolean)
  if (words.length === 0) return '?'
  const letters =
    words.length > 1
      ? `${words[0]![0]}${words[1]![0]}`
      : // `Array.from` so an emoji or any astral character counts as ONE letter; slicing a
        // surrogate pair in half renders a replacement glyph.
        Array.from(words[0]!).slice(0, 2).join('')
  return letters.toLocaleUpperCase()
}

/**
 * The yellow-green arc, skipped.
 *
 * OKLCH holds one lightness across the wheel, but it cannot make every hue attractive at a
 * DARK one: 55–115° at the tile's lightness is olive, and its light-theme counterpart is
 * mustard. Excluding the arc rather than curating a fixed palette keeps the remaining 300°
 * continuous, so two agents still almost never share a colour — a palette of eight, the way
 * a messenger does it, collides more often than not once five agents are in the list.
 */
const MUDDY_START = 55
const MUDDY_WIDTH = 60

/**
 * The tile's colour, as a hue the caller drops into OKLCH.
 *
 * A hue and nothing else: lightness and chroma are FIXED by the theme, which is what makes a
 * roster read as one set. Generators that vary all three produce a screaming yellow beside a
 * muddy blue, because HSL lightness is not perceptual — OKLCH's is, so one pair of constants
 * holds across the whole wheel.
 */
export const avatarHue = (name: string): number => {
  // `% 360` FIRST, then squeeze — not `% 300` directly. The modulus matters: FNV-1a is
  // measurably uniform mod 360 and measurably lumpy mod 300, and taking the shorter arc
  // straight off the hash put eight of ten real handles in the same red arc.
  const hue = Math.floor(((avatarHash(name) % 360) * (360 - MUDDY_WIDTH)) / 360)
  return hue < MUDDY_START ? hue : hue + MUDDY_WIDTH
}

export interface AvatarSeed {
  hue: number
  initials: string
}

/**
 * The whole identity from the two things a caller has.
 *
 * The HUE comes from the handle and the LETTERS from the label, on purpose: renaming an
 * agent's display label re-letters its tile but keeps its colour, so the roster stays
 * recognisable through a rename. The handle is the identity; the label is what it is called
 * today.
 */
export function avatarSeed(handle: string, label?: string): AvatarSeed {
  return { hue: avatarHue(handle), initials: avatarInitials(label?.trim() || handle) }
}

import { cn } from '@localixai/plugin-sdk/ui/classes'
import { avatarHue, avatarSeed } from './avatar-seed'

const TILE = 'oklch(var(--avatar-tile-l) var(--avatar-tile-c) var(--avatar-hue))'
const INK = 'oklch(var(--avatar-ink-l) var(--avatar-ink-c) var(--avatar-hue))'

/**
 * A tile's own colour as a TEXT colour — for the name printed beside it.
 *
 * The same hue in both places is what makes the pair read as one identity, and it is how a
 * chat client lets you find one speaker in a wall of messages. It is the `--avatar-ink` side
 * because that is the tone already proven readable as text on the page ground, in both themes.
 */
export function monogramInkStyle(identity: string): React.CSSProperties {
  return { '--avatar-hue': String(avatarHue(identity)), color: INK } as React.CSSProperties
}

/**
 * A monogram tile for anything that has a stable identity and a display name — an agent, a
 * conversation, later a room.
 *
 * The two inputs are deliberately different things. The COLOUR comes from the identity (a
 * handle, a session id): the thing that does not change. The LETTERS come from the label: the
 * thing that does. So renaming re-letters a tile and keeps its colour, and the list stays
 * recognisable through a rename.
 *
 * Which identity to pass is the caller's judgement, and it is not always the obvious one. A
 * transcript's reply is the AGENT's, so its tile is the agent's. A sidebar row is the
 * CONVERSATION's: we are not a messenger where you have one chat per person — twenty chats
 * with one agent would be a column of identical tiles, which is no help at all.
 *
 * TINTED, not saturated. A list holds twenty of these, and twenty saturated squares fight the
 * content they label; a pale tile with a saturated monogram is as distinguishable and stays
 * quiet. It also fixes the contrast problem the obvious version has — white text on a
 * mid-lightness generated colour lands near 3:1, under the floor for text.
 *
 * The hue is the element's; lightness and chroma are the theme's (`--avatar-*-l` /
 * `--avatar-*-c` in `app/index.css`), so the tile answers to a theme switch without this file
 * knowing either palette. The colour has to be COMPOSED here rather than read as one finished
 * token: a custom property's `var()` references are substituted where the property is
 * declared, so a token built on `:root` would resolve the hue against `:root` — which has
 * none — and paint every tile the same fallback colour.
 */
export interface MonogramAvatarProps {
  /** What does NOT change: an agent handle, a session id. The colour comes from this. */
  identity: string
  /** What is displayed: a title, a label. The letters come from this. */
  label?: string
  /** Edge length in px. The monogram scales with it. */
  size?: number
  className?: string
}

export function MonogramAvatar({ identity, label, size = 28, className }: MonogramAvatarProps) {
  const { hue, initials } = avatarSeed(identity, label)
  return (
    <span
      // Decorative: every place this appears already names its subject in text beside it, so
      // announcing the initials again would read the same thing twice.
      aria-hidden="true"
      data-slot="monogram-avatar"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-md font-semibold leading-none',
        className,
      )}
      style={
        {
          width: size,
          height: size,
          // 0.4 keeps two letters inside the tile at every size we use it at (16–40px).
          fontSize: Math.round(size * 0.4),
          '--avatar-hue': String(hue),
          backgroundColor: TILE,
          color: INK,
        } as React.CSSProperties
      }
    >
      {initials}
    </span>
  )
}

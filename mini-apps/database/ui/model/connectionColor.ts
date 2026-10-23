import { CONNECTION_COLORS, type ConnectionColor } from '../dbClient'

/**
 * Maps a connection's optional color tag (a curated named token, defined ONCE in the API
 * contract) to the FULL, STATIC Tailwind class strings each workbench surface uses — a
 * dot, a text tint, and a subtle left-border accent. The class strings are literal so
 * the Tailwind JIT can see them (a composed `bg-conn-${token}` would be invisible to it);
 * the CSS vars behind `conn-*` are theme-aware (see `app/index.css`). Colors are pure
 * metadata — nothing here touches query execution.
 */

export { CONNECTION_COLORS }
export type { ConnectionColor }

/** Human labels for the picker swatches (title/aria). */
export const CONNECTION_COLOR_LABEL: Record<ConnectionColor, string> = {
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  pink: 'Pink',
  slate: 'Slate',
}

// Full literal class strings — never build these dynamically (JIT can't see composed names).
const DOT_CLASS: Record<ConnectionColor, string> = {
  red: 'bg-conn-red',
  amber: 'bg-conn-amber',
  green: 'bg-conn-green',
  blue: 'bg-conn-blue',
  violet: 'bg-conn-violet',
  pink: 'bg-conn-pink',
  slate: 'bg-conn-slate',
}

const TEXT_CLASS: Record<ConnectionColor, string> = {
  red: 'text-conn-red',
  amber: 'text-conn-amber',
  green: 'text-conn-green',
  blue: 'text-conn-blue',
  violet: 'text-conn-violet',
  pink: 'text-conn-pink',
  slate: 'text-conn-slate',
}

const BORDER_LEFT_CLASS: Record<ConnectionColor, string> = {
  red: 'border-l-conn-red',
  amber: 'border-l-conn-amber',
  green: 'border-l-conn-green',
  blue: 'border-l-conn-blue',
  violet: 'border-l-conn-violet',
  pink: 'border-l-conn-pink',
  slate: 'border-l-conn-slate',
}

/** True for a recognized palette token (narrows an untrusted string). */
export function isConnectionColor(value: unknown): value is ConnectionColor {
  return typeof value === 'string' && (CONNECTION_COLORS as readonly string[]).includes(value)
}

/** Background class for a solid swatch/dot, or null for "None" (neutral look). */
export function connectionDotClass(color: string | null | undefined): string | null {
  return isConnectionColor(color) ? DOT_CLASS[color] : null
}

/** Text/foreground tint class (e.g. a colored tab icon), or null for "None". */
export function connectionTextClass(color: string | null | undefined): string | null {
  return isConnectionColor(color) ? TEXT_CLASS[color] : null
}

/** Left-border accent class (a subtle colored edge on a row/tab), or null for "None". */
export function connectionBorderLeftClass(color: string | null | undefined): string | null {
  return isConnectionColor(color) ? BORDER_LEFT_CLASS[color] : null
}

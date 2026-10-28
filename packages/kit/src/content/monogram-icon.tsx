import type { IconComponent } from '@localixai/mini-app-sdk/ui'
import { MonogramAvatar } from './monogram-avatar'

/**
 * An identity's monogram as a menu row's `icon` — an agent in a picker or a directory list.
 *
 * The defects it closes, both met in the composer's menus:
 *   - each surface built its own: one cached a factory privately, another hand-built menu rows
 *     around an 18px tile, so the same agent was a different size in two lists;
 *   - a 16px tile in the 14px icon slot pushed its row's label 2px right of every glyph row, and
 *     past the slot's edges by a pixel each side.
 *
 * So the tile is 16px — any smaller and the letters stop reading — with a 1px negative margin: its
 * LAYOUT box is the slot's 14px, so it centres in the slot exactly and the label column stays the
 * one every icon row shares.
 *
 * CACHED per (identity, label): a row's icon must be the same component on every render or the
 * tile remounts on each pick, and a rename must re-letter it. A menu lists a handful of agents, so
 * the cache stays as small as the menus it has seen.
 */
const ICONS = new Map<string, IconComponent>()

export function monogramIcon(identity: string, label: string): IconComponent {
  const key = `${identity}\u0000${label}`
  const cached = ICONS.get(key)
  if (cached) return cached
  const Monogram = () => (
    <MonogramAvatar identity={identity} label={label} size={16} className="-m-px" />
  )
  Monogram.displayName = `MonogramIcon(${identity})`
  ICONS.set(key, Monogram)
  return Monogram
}

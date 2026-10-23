import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

/**
 * The per-connection set of starred market symbols, persisted in localStorage. ONE source of
 * truth shared by the sidebar's market browser and the chart-header market picker, so a star
 * toggled in one surface is a star in the other. The key is stable
 * (`localix.trading.favs.<connId>`), so this replaces the sidebar's former inline helpers rather
 * than adding a second store.
 */

const favsKey = (connId: string) => `localix.trading.favs.${connId}`

/** The connection's starred symbols. An unset / malformed store reads as empty, never throws. */
export function loadFavourites(connId: string): Set<string> {
  return new Set(loadJSON<string[]>(favsKey(connId)) ?? [])
}

/**
 * Flip `symbol`'s starred state and persist, returning the new set. Pure of any React state — the
 * caller bumps its own re-read version after.
 */
export function toggleFavourite(connId: string, symbol: string): Set<string> {
  const next = loadFavourites(connId)
  if (next.has(symbol)) next.delete(symbol)
  else next.add(symbol)
  saveJSON(favsKey(connId), [...next])
  return next
}

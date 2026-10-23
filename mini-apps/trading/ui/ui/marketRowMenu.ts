import { CandlestickChart, Copy, Star, StarOff } from 'lucide-react'
import type { Market } from '../../backend/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'

/**
 * A market row's context menu.
 *
 * The row's star is `opacity-0` until hover unless the market is ALREADY a favourite, so on a
 * touch pass the only way to favourite something was to have already done it. Copy symbol is here
 * because the row is otherwise a drag surface and a chart opener: the one thing a person actually
 * wants as text — the ticker — had to be retyped.
 */
export function marketRowMenu(
  market: Market,
  favourite: boolean,
  onOpen: (market: Market) => void,
  onToggleFavourite: (symbol: string) => void,
): MenuEntry[] {
  return [
    { id: 'open', label: 'Open chart', icon: CandlestickChart, onSelect: () => onOpen(market) },
    { separator: true },
    {
      id: 'favourite',
      label: favourite ? 'Remove from favourites' : 'Add to favourites',
      icon: favourite ? StarOff : Star,
      onSelect: () => onToggleFavourite(market.symbol),
    },
    {
      id: 'copy-symbol',
      label: 'Copy symbol',
      icon: Copy,
      hint: market.symbol,
      onSelect: () => void copyText(market.symbol, 'Symbol'),
    },
  ]
}

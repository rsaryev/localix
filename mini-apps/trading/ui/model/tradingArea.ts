import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

export const TRADING_AREA_KEY = 'localix.trading.area'

export type TradingArea = 'overview' | 'markets' | 'connections'

const AREAS = new Set<TradingArea>(['overview', 'markets', 'connections'])

/** Normalize persisted or externally supplied workspace navigation state. */
export function normalizeTradingArea(value: unknown): TradingArea {
  return typeof value === 'string' && AREAS.has(value as TradingArea)
    ? (value as TradingArea)
    : 'overview'
}

export function loadTradingArea(): TradingArea {
  return normalizeTradingArea(loadString(TRADING_AREA_KEY))
}

export function saveTradingArea(area: TradingArea): void {
  saveString(TRADING_AREA_KEY, area)
}

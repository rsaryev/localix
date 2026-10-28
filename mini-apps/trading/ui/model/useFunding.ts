import { useEffect, useState } from 'react'
import { tradingApi } from '../api/tradingApi'
import { fundingRead, type FundingRead } from '../../backend/analysis/funding-read'

/**
 * The perp funding positioning read for a market, computed CLIENT-SIDE by the SAME
 * `fundingRead` the detect scan runs — so the Technicals page and the agent read the identical
 * crowding state. Only a PERPETUAL (unified symbol with a `:settle` suffix) has funding; a spot
 * symbol skips the fetch entirely. Best-effort and slow-moving (funding settles once per venue
 * period): one read on mount / market change, no polling. Null until it lands, or when the read
 * fails / the venue reports no interval to normalize by (fundingRead abstains).
 */
export function useFunding(
  connectionId: string,
  symbol: string,
  enabled = true,
): FundingRead | null {
  const isPerp = symbol.includes(':')
  // A read belongs to the market it was fetched for: another market (or a parked hook) reads as
  // null at once, with no reset effect — the previous market's funding is not this one's.
  const target = enabled && isPerp ? `${connectionId}/${symbol}` : null
  const [stored, setStored] = useState<{ target: string; read: FundingRead | null } | null>(null)

  useEffect(() => {
    if (!target) return
    let alive = true
    tradingApi.funding(connectionId, symbol).then(
      (f) => {
        if (alive) setStored({ target, read: fundingRead(f) })
      },
      () => {
        if (alive) setStored({ target, read: null })
      },
    )
    return () => {
      alive = false
    }
  }, [connectionId, symbol, target])

  return stored?.target === target ? (stored?.read ?? null) : null
}

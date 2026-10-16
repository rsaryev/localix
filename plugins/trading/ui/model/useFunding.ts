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
  const [read, setRead] = useState<FundingRead | null>(null)
  const isPerp = symbol.includes(':')

  useEffect(() => {
    if (!enabled || !isPerp) {
      setRead(null)
      return
    }
    let alive = true
    setRead(null)
    tradingApi.funding(connectionId, symbol).then(
      (f) => {
        if (alive) setRead(fundingRead(f))
      },
      () => {
        if (alive) setRead(null)
      },
    )
    return () => {
      alive = false
    }
  }, [connectionId, symbol, enabled, isPerp])

  return read
}

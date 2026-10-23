import { useCallback, useEffect, useState } from 'react'
import type { FundingRate, OpenInterest } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { tradingApi } from '../api/tradingApi'

export interface ContractStats {
  funding: FundingRate | null
  openInterest: OpenInterest | null
}

/**
 * How often to re-read. Funding settles once per venue period (hourly at the fastest) and open
 * interest drifts slowly, so a 60s poll is already generous — the chart's price feed carries the
 * fast-moving data.
 */
const POLL_MS = 60_000

/**
 * A derivative market's carry cost and outstanding size.
 *
 * `funding` / `openInterest` in `opts` are the venue's own capability claims
 * (`describe.capabilities.* !== 'none'`): a venue that REPORTS it does not serve a read is never
 * asked — the request would only round-trip to a `not_supported` error (Coinbase International
 * reports no open interest, e.g.). `undefined` (capabilities not loaded) is treated as capable, so
 * an unknown venue is still asked rather than silently shown nothing.
 *
 * Spot markets, and venues that report neither, answer `null` — a genuine "there is none", not a
 * failure. A FAILED read is also `null` here, but the caller renders nothing either way: the one
 * thing this must never do is render a zero rate, which reads as "free to hold". Each read degrades
 * independently so a venue that serves funding but not open interest still shows funding.
 */
export function useContractStats(
  connectionId: string,
  symbol: string,
  opts: { enabled?: boolean; funding?: boolean; openInterest?: boolean } = {},
): ContractStats {
  const [stats, setStats] = useState<ContractStats>({ funding: null, openInterest: null })
  const askFunding = opts.funding ?? true
  const askOpenInterest = opts.openInterest ?? true
  const on = (opts.enabled ?? true) && !!connectionId && !!symbol && (askFunding || askOpenInterest)

  const refresh = useCallback(async () => {
    if (!on) return
    const [funding, openInterest] = await Promise.all([
      askFunding
        ? tradingApi.funding(connectionId, symbol).catch(() => null)
        : Promise.resolve(null),
      askOpenInterest
        ? tradingApi.openInterest(connectionId, symbol).catch(() => null)
        : Promise.resolve(null),
    ])
    setStats({ funding, openInterest })
  }, [connectionId, symbol, on, askFunding, askOpenInterest])

  // Clear immediately on a target change: the previous market's funding is not this one's.
  useEffect(() => {
    setStats({ funding: null, openInterest: null })
  }, [connectionId, symbol])

  useVisiblePolling({
    enabled: on,
    intervalMs: POLL_MS,
    onTick: () => refresh(),
    immediate: true,
    resetKey: `${connectionId}/${symbol}/${String(askFunding)}/${String(askOpenInterest)}`,
  })

  return stats
}

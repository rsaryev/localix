import { useEffect, useState } from 'react'
import { CandlestickChart, ShieldCheck } from 'lucide-react'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { OverviewRegistryRow } from '@localixai/kit/overview-registry-row'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { tradingApi } from './api/tradingApi'
import { useTradingProblem, type TradingFailure } from './problems'
import type { TradingArea } from './model/tradingArea'

interface OverviewSnapshot {
  /** How many venues the installed driver can read. */
  venues: number | null
}

const EMPTY_SNAPSHOT: OverviewSnapshot = { venues: null }

function metric(value: number | null): string | number {
  return value === null ? '—' : value
}

export function TradingOverview({
  onOpen,
  active = true,
}: {
  onOpen: (area: TradingArea) => void
  active?: boolean
}) {
  // The outcome of the last read, tagged with the reload it answered: a read still in flight (the
  // nonce moved on) is `loading` over what was shown, with no state write when it starts.
  const [outcome, setOutcome] = useState<{
    nonce: number
    snapshot: OverviewSnapshot
    failure: TradingFailure | null
  } | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const snapshot = outcome?.snapshot ?? EMPTY_SNAPSHOT
  const failure = outcome?.failure ?? null
  const loading = outcome?.nonce !== reloadNonce

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void tradingApi.exchanges().then(
      (catalog) => {
        if (cancelled) return
        setOutcome({ nonce: reloadNonce, snapshot: { venues: catalog.length }, failure: null })
      },
      (error: unknown) => {
        if (cancelled) return
        // Kept, not swallowed: the count used to fall back to "—" with no word about why.
        setOutcome({
          nonce: reloadNonce,
          snapshot: EMPTY_SNAPSHOT,
          failure: { message: errorMessage(error, 'Could not read the data sources.') },
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [active, reloadNonce])
  const problem = useTradingProblem({
    subject: 'Trading data sources',
    failure,
    onRetry: () => setReloadNonce((value) => value + 1),
  })

  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-y-auto px-4 py-4 @2xl:px-6">
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-foreground">Trading Workspace</h1>
            <p className="mt-0.5 text-xs text-text-faint">
              Research public markets and inspect live structure in one place.
            </p>
          </div>
          <RefreshAction
            size="sm"
            aria-label="Refresh Trading overview"
            tooltip="Refresh Trading overview"
            busy={loading}
            onClick={() => setReloadNonce((value) => value + 1)}
          />
        </div>

        {problem && <ProblemLine {...problem} />}

        <section aria-label="Trading areas" className="grid gap-3 @2xl:grid-cols-2">
          <OverviewRegistryRow
            title="Markets"
            description="Browse venues and instruments, then open charts, order books, trades, and technicals."
            icon={CandlestickChart}
            onOpen={() => onOpen('markets')}
            metrics={[
              { label: 'Data sources', value: metric(snapshot.venues) },
              { label: 'Mode', value: 'Public' },
            ]}
          />
        </section>

        <section
          aria-label="Trading safety"
          className={cn(
            'flex items-start gap-2.5 border-y border-border-soft px-1 py-3',
            loading && 'opacity-80',
          )}
        >
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-success" />
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-foreground">Research-first safety boundary</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-text-faint">
              The registered market browser uses public, read-only exchange data. This mini app
              entry point does not register an account or order-execution surface.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

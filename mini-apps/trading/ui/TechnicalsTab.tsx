import { useEffect, useMemo, useState } from 'react'
import type { Candle } from '../backend/contracts'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useFunding } from './model/useFunding'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { useTradingProblem } from './problems'
import { useOhlcv } from './model/useOhlcv'
import { computeChartRead } from './model/chartRead'
import {
  computeTechnicalRatings,
  sortRatingRows,
  type RatingGroup,
  type RatingRow,
  type RatingSort,
} from './model/technicalRatings'
import { publishTimeframeVerdict, useTimeframeVerdicts } from './model/useTimeframeVerdicts'
import { VERDICT_DOT, VERDICT_LABEL } from './model/verdictPresentation'
import { RatingGauge } from './ui/RatingGauge'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { SegmentedRadioGroup } from '@localixai/mini-app-sdk/ui/segmented-control'
import { buildTradeUri } from '../backend/uri'
import { DEFAULT_TIMEFRAME, TECHNICALS_TIMEFRAMES } from '../backend/timeframes'

/**
 * The TECHNICALS tab — a full technical-rating page for one market, opened from
 * the chart's control cluster. Three gauges (Oscillators / Summary / Moving Averages) over the two
 * vote tables, then the mini app's own analysis lenses (structure, VWAP, value area, confluence,
 * volatility). Everything is computed CLIENT-SIDE from the same
 * candles the chart loads, by the same `backend/analysis` + indicator math the agent's detect
 * uses — one math, every surface.
 *
 * The whole page scrolls; the ratings recompute as candles stream (pure and cheap — a few dozen
 * indicator passes over a bounded window).
 */

const TIMEFRAMES = TECHNICALS_TIMEFRAMES

/** Persisted table-order preference (global — the habit carries across markets). */
const SORT_KEY = 'trading.technicals.sort'

export function TechnicalsTab({
  connectionId,
  symbol,
  active = true,
  publishMessageContext,
}: {
  connectionId: string
  symbol: string
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_TIMEFRAME)
  // Paused while warm-hidden (the grid keeps recent tab bodies mounted); repaints on re-show.
  const [tabRootRef, tabVisible] = useElementVisible<HTMLDivElement>()
  const dataActive = active && tabVisible
  const [sort, setSort] = useState<RatingSort>(() =>
    loadJSON<RatingSort>(SORT_KEY) === 'signal' ? 'signal' : 'standard',
  )
  useEffect(() => saveJSON(SORT_KEY, sort === 'standard' ? null : sort), [sort])
  useEffect(() => {
    if (!publishMessageContext) return
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: buildTradeUri({
            kind: 'marketLeaf',
            connectionId,
            symbol,
            leaf: 'technicals',
            timeframe,
          }),
          label: `${symbol} ${timeframe} technicals`,
        }),
      ],
    })
  }, [connectionId, publishMessageContext, symbol, timeframe])
  const { candles, loading, unreachable, error } = useOhlcv(connectionId, symbol, timeframe, {
    enabled: dataActive,
  })
  // Owned above the branches; the arm that draws it is gone the moment candles arrive.
  const problem = useTradingProblem({
    subject: `${symbol} technicals`,
    failure: candles.length === 0 ? error : null,
  })
  const ratings = useMemo(
    () => (candles.length > 0 ? computeTechnicalRatings(candles as Candle[]) : null),
    [candles],
  )

  // The ACTIVE timeframe's verdict is already computed above — hand it to the strip's cache so
  // that timeframe is never fetched a second time. One of the five reads, and the likeliest one
  // (the strip's list contains whatever the user is looking at).
  useEffect(() => {
    if (!ratings) return
    publishTimeframeVerdict(connectionId, symbol, timeframe, ratings.summary.verdict)
  }, [ratings, connectionId, symbol, timeframe])

  // One summary verdict per timeframe — the alignment strip (does the 1d agree with the 5m?).
  //
  // HELD BACK until this page's own history has landed. The venue's rate limiter is a single
  // serial queue, and four background reads racing the read the user is waiting for is the same
  // mistake the chart tab already measured and fixed (candles alone 2050ms, candles racing one
  // extra read 2976ms — see `TradingChartTab`). The strip is a cross-check on a rating that does
  // not exist yet; it can wait for the rating.
  const tfVerdicts = useTimeframeVerdicts(
    connectionId,
    symbol,
    TIMEFRAMES,
    dataActive && ratings !== null,
  )
  const read = useMemo(
    () => (candles.length > 0 ? computeChartRead(candles as Candle[], timeframe) : null),
    [candles, timeframe],
  )
  // Perp funding positioning — the same fundingRead the detect scan reports (spot skips it).
  const funding = useFunding(connectionId, symbol, dataActive)

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div ref={tabRootRef} className="@container scrollbar-thin h-full min-h-0 overflow-y-auto">
      {/* FULL WIDTH: the page used to sit in a 56rem column, which left a wide tab mostly empty
          while the two vote tables stayed cramped side by side. The tables and the lens cards are
          the content — they get the whole tab and reflow by CONTAINER width (the tab is a grid
          pane, so the viewport says nothing about how much room this page actually has). */}
      <div className="flex flex-col gap-4 px-5 py-4">
        {/* Header row: what is being rated, and over which timeframe. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{symbol}</span>
            <span className="text-2xs text-text-faint">
              Technical rating · computed from the loaded {timeframe} candles
            </span>
          </div>
          {/* Timeframe picker doubling as the ALIGNMENT strip: each segment carries that
              timeframe's own summary verdict as a colored dot (tooltip says it in words) —
              one glance answers whether the 1d agrees with the 5m. */}
          <SegmentedRadioGroup
            size="sm"
            variant="ghost"
            value={timeframe}
            onValueChange={setTimeframe}
            aria-label="Timeframe"
            options={TIMEFRAMES.map((tf) => {
              const verdict = tfVerdicts[tf]
              return {
                value: tf,
                title: verdict ? `${tf}: ${VERDICT_LABEL[verdict]}` : undefined,
                label: (
                  <>
                    {tf}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 rounded-full',
                        verdict ? VERDICT_DOT[verdict] : 'bg-border/60',
                      )}
                    />
                  </>
                ),
              }
            })}
          />
        </div>

        {loading && candles.length === 0 ? (
          <StatusPane>
            <LoadingHint>Loading candles…</LoadingHint>
          </StatusPane>
        ) : unreachable && candles.length === 0 ? (
          <StatusPane>
            <EmptyHint>Venue unreachable.</EmptyHint>
          </StatusPane>
        ) : error && candles.length === 0 ? (
          // Empty BECAUSE the read failed — a report, not an empty-state hint.
          <StatusPane>{problem && <ProblemLine {...problem} />}</StatusPane>
        ) : !ratings ? (
          <StatusPane>
            <EmptyHint>Not enough candles on {timeframe} to rate.</EmptyHint>
          </StatusPane>
        ) : (
          <>
            {/* The three dials share one quiet inspector section (wrapping on narrow tabs);
                the pooled summary sits center and larger. */}
            <div className="flex flex-wrap items-end justify-evenly gap-x-10 gap-y-4 border-y border-border-faint px-4 py-4">
              <RatingGauge title="Oscillators" group={ratings.oscillators} />
              <RatingGauge title="Summary" group={ratings.summary} size="lg" />
              <RatingGauge title="Moving averages" group={ratings.movingAverages} />
            </div>

            {/* Table order — canonical published order, or grouped by what's voting buy/sell. */}
            <SegmentedRadioGroup
              size="sm"
              variant="ghost"
              className="ml-auto"
              aria-label="Table order"
              value={sort}
              onValueChange={setSort}
              options={[
                { value: 'standard', label: 'Standard order' },
                { value: 'signal', label: 'By signal' },
              ]}
            />

            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              <RatingTable title="Oscillators" group={ratings.oscillators} sort={sort} />
              <RatingTable title="Moving averages" group={ratings.movingAverages} sort={sort} />
            </div>

            {/* The two lens sections ride side by side once the container has room — on a wide tab
                they are short lists, and stacking them buried the smart-money section below a fold
                that only existed because the page sat in a narrow column. */}
            <div className="grid items-start gap-4 @4xl:grid-cols-2">
              {/* The house lenses beyond the classic tables — the one place the live read is shown. */}
              {read && (
                <section className="flex flex-col gap-2 border-y border-border-faint py-3">
                  <span className="text-2xs font-medium uppercase tracking-wider text-text-faint">
                    Beyond the classics
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {read.regime && (
                      <Lens label="Regime">
                        <span className="capitalize text-foreground">{read.regime.kind}</span>
                      </Lens>
                    )}
                    {read.structureBreak && (
                      <Lens label="Structure">
                        <span
                          className={
                            read.structureBreak.direction === 'bullish'
                              ? 'text-status-success'
                              : 'text-status-error'
                          }
                        >
                          {read.structureBreak.type}{' '}
                          {read.structureBreak.type === 'BOS' ? 'continuation' : 'character change'}
                        </span>
                      </Lens>
                    )}
                    {read.confluence.length > 0 && (
                      <Lens label="Confluence">
                        <span className="text-text-soft">
                          {read.confluence[0]!.sources.length} methods @{' '}
                          {Number(read.confluence[0]!.price.toPrecision(6))} (
                          {read.confluence[0]!.distancePct >= 0 ? '+' : ''}
                          {read.confluence[0]!.distancePct.toFixed(1)}%)
                        </span>
                      </Lens>
                    )}
                    {read.vwap && (
                      <Lens label="Session VWAP">
                        <span
                          className={cn(
                            read.vwap.distancePct > 0.05
                              ? 'text-status-success'
                              : read.vwap.distancePct < -0.05
                                ? 'text-status-error'
                                : 'text-text-soft',
                          )}
                        >
                          {Number(read.vwap.vwap.toPrecision(6))} (
                          {read.vwap.distancePct >= 0 ? '+' : ''}
                          {read.vwap.distancePct.toFixed(2)}%)
                        </span>
                      </Lens>
                    )}
                    {read.valueArea && (
                      <Lens label="Value area">
                        <span
                          className={cn(
                            'font-medium capitalize',
                            read.valueArea.position === 'premium'
                              ? 'text-status-error'
                              : read.valueArea.position === 'discount'
                                ? 'text-status-success'
                                : 'text-text-soft',
                          )}
                        >
                          {read.valueArea.position}
                        </span>
                      </Lens>
                    )}
                    {read.volatility && (
                      <Lens label="Volatility">
                        <span className="text-text-soft">
                          ATR {read.volatility.atrPct.toFixed(2)}% · {read.volatility.trend}
                          {read.hv && (
                            <span
                              className={cn(
                                read.hv.state !== 'normal' && 'font-medium text-foreground',
                              )}
                              title={`Realized vol at the ${Math.round(read.hv.percentile)}th percentile of the loaded window.`}
                            >
                              {' '}
                              · HV p{Math.round(read.hv.percentile)}
                              {read.hv.state === 'compressed'
                                ? ' squeeze'
                                : read.hv.state === 'elevated'
                                  ? ' stretched'
                                  : ''}
                            </span>
                          )}
                        </span>
                      </Lens>
                    )}
                    {funding && (
                      <Lens label="Funding">
                        <span
                          className={cn(
                            funding.state === 'extreme_long_crowding'
                              ? 'text-status-error'
                              : funding.state === 'short_squeeze_territory'
                                ? 'text-status-success'
                                : 'text-text-soft',
                          )}
                          title="Perp funding normalized to an 8h rate. Positive = longs pay shorts; extremes mark the crowded side that squeezes."
                        >
                          {funding.ratePct8h >= 0 ? '+' : ''}
                          {funding.ratePct8h.toFixed(4)}%/8h
                          {funding.state === 'extreme_long_crowding'
                            ? ' · longs crowded'
                            : funding.state === 'short_squeeze_territory'
                              ? ' · shorts crowded'
                              : ''}
                        </span>
                      </Lens>
                    )}
                  </div>
                </section>
              )}

              {/* Smart-money zones + gated school signals — the event-driven layer beside the
                  always-on lenses above. Rows render only when something actually printed. */}
              {read &&
                (read.fvg ||
                  read.orderBlock ||
                  read.liquidity.length > 0 ||
                  read.ichimoku ||
                  read.harmonic) && (
                  <section className="flex flex-col gap-2 border-y border-border-faint py-3">
                    <span className="text-2xs font-medium uppercase tracking-wider text-text-faint">
                      Smart money & signals
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {read.fvg && (
                        <Lens label="Fair value gap">
                          <span
                            className={
                              read.fvg.direction === 'bullish'
                                ? 'text-status-success'
                                : 'text-status-error'
                            }
                            title="An unfilled 3-candle imbalance — price tends to return and fill it."
                          >
                            {read.fvg.direction} {fmt(read.fvg.bottom)}–{fmt(read.fvg.top)}
                            {read.fvg.distancePct === 0
                              ? ' · INSIDE now'
                              : ` (${signedPct(read.fvg.distancePct)})`}
                          </span>
                        </Lens>
                      )}
                      {read.orderBlock && (
                        <Lens label="Order block">
                          <span
                            className={
                              read.orderBlock.direction === 'bullish'
                                ? 'text-status-success'
                                : 'text-status-error'
                            }
                            title="The last opposite candle before a displacement — a retest of it tends to react."
                          >
                            {read.orderBlock.direction} {fmt(read.orderBlock.bottom)}–
                            {fmt(read.orderBlock.top)}
                            {read.orderBlock.distancePct === 0
                              ? ' · RETEST now'
                              : ` (${signedPct(read.orderBlock.distancePct)})`}
                          </span>
                        </Lens>
                      )}
                      {read.liquidity.length > 0 && (
                        <Lens label="Liquidity">
                          <span className="flex flex-wrap justify-end gap-x-2">
                            {read.liquidity.map((p) => (
                              <span
                                key={`${p.side}-${p.price}`}
                                className={cn(p.swept && 'font-medium text-foreground')}
                                title={`${p.touches} equal ${p.side === 'buy-side' ? 'highs' : 'lows'} — resting stops the market is drawn to sweep.${p.swept ? ' JUST SWEPT: the classic stop-grab reversal tell.' : ''}`}
                              >
                                {p.side === 'buy-side' ? '↑' : '↓'} {fmt(p.price)}
                                {p.swept ? ' swept' : ''}
                              </span>
                            ))}
                          </span>
                        </Lens>
                      )}
                      {read.ichimoku && (
                        <Lens label="Ichimoku">
                          <span
                            className={cn(
                              read.ichimoku.verdict === 'long'
                                ? 'text-status-success'
                                : read.ichimoku.verdict === 'short'
                                  ? 'text-status-error'
                                  : 'text-text-soft',
                            )}
                            title={
                              read.ichimoku.verdict === 'stand_aside'
                                ? `A ${read.ichimoku.cross} TK cross printed, but: ${read.ichimoku.failed.join('; ')}.`
                                : 'TK cross with price on the right side of a matching cloud — the school’s own gated entry.'
                            }
                          >
                            {read.ichimoku.verdict === 'stand_aside'
                              ? `${read.ichimoku.cross} cross · stand aside`
                              : `gated ${read.ichimoku.verdict.toUpperCase()}`}
                          </span>
                        </Lens>
                      )}
                      {read.harmonic && (
                        <Lens label="Harmonic">
                          <span
                            className={
                              read.harmonic.direction === 'bullish'
                                ? 'text-status-success'
                                : 'text-status-error'
                            }
                            title={`B retraced ${read.harmonic.bRatio.toFixed(3)} of XA, D ${read.harmonic.dRatio.toFixed(3)} — geometry, not a guarantee; demand a reaction at the zone.`}
                          >
                            {read.harmonic.direction} {read.harmonic.pattern.toUpperCase()} · PRZ{' '}
                            {fmt(read.harmonic.d)}
                          </span>
                        </Lens>
                      )}
                    </div>
                  </section>
                )}
            </div>

            <span className="pb-2 text-center text-2xs text-text-faint">
              Textbook rules over the loaded candles — a rating, not a recommendation.
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/** A centered pane for the loading / empty / not-enough states — so a status message reads as a
 *  deliberate centerpiece rather than a stray line of small text pinned to the top-left. */
function StatusPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[16rem] flex-1 items-center justify-center py-10">{children}</div>
  )
}

/** Six significant digits for a price, four for a ratio-ish figure — compact and citable. */
const fmt = (v: number): string => String(Number(v.toPrecision(6)))
const signedPct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

/** One aligned lens row (label left, value right) — the popover's ReadRow shape. */
function Lens({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-2xs">
      <span className="shrink-0 text-text-faint">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}

const ACTION_LABEL = { buy: 'Buy', sell: 'Sell', neutral: 'Neutral' } as const

function RatingTable({
  title,
  group,
  sort,
}: {
  title: string
  group: RatingGroup
  sort: RatingSort
}) {
  const rows = sortRatingRows(group.rows, sort)
  return (
    <div className="flex flex-col border-y border-border-faint">
      <div className="flex items-center justify-between border-b border-border-faint px-2.5 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-text-faint">
          {title}
        </span>
        <span className="text-2xs tabular-nums text-text-faint">
          <span className="text-status-error/80">{group.sells} sell</span> ·{' '}
          <span>{group.neutrals} neutral</span> ·{' '}
          <span className="text-status-success/80">{group.buys} buy</span>
        </span>
      </div>
      {rows.map((row) => (
        <RatingTableRow key={row.name} row={row} />
      ))}
    </div>
  )
}

function RatingTableRow({ row }: { row: RatingRow }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border-faint px-2.5 py-1 text-2xs last:border-b-0">
      <span className="min-w-0 truncate text-text-soft">{row.name}</span>
      <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
        <span className="text-text-faint">
          {row.value === null
            ? '—'
            : Math.abs(row.value) >= 1000
              ? row.value.toFixed(1)
              : Number(row.value.toPrecision(4)).toString()}
        </span>
        <span
          className={cn(
            'w-12 text-right font-medium',
            row.action === 'buy'
              ? 'text-status-success'
              : row.action === 'sell'
                ? 'text-status-error'
                : 'text-text-faint',
          )}
        >
          {row.action === null ? '—' : ACTION_LABEL[row.action]}
        </span>
      </span>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import type { FundingRate, Market, OpenInterest, PrecisionMode } from '../../backend/contracts'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  formatCompactVolume,
  formatCountdown,
  formatFundingRate,
  formatPercent,
  formatPrice,
} from '../model/formatQuote'
import { sizeUnit } from '../../backend/size-unit'
import {
  baseVolumeUnitLabel,
  formatSpan,
  rangePosition,
  type MarketSummary,
} from '../model/quoteSummary'
import { askAgent, buildCarryStatPrefill } from '../model/askAgent'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { marketInactiveBadge } from '../model/marketBadges'
import { MarketPicker } from './MarketPicker'
import { useSecondTick } from '../model/useSecondTick'

/**
 * The chart's quote header.
 *
 * The symbol is a BUTTON that opens the market switcher (Hyperliquid-style): one price with its
 * move, then a strip of context read as LABEL-over-VALUE columns — the shape every trading terminal
 * uses, because a bare number with an inline caption is unscannable. Each figure names the window it
 * measures and the unit it is in. Everything optional (mark, index, funding, open interest) appears
 * only when the venue reports it, so a spot market shows a short row rather than a row of em-dashes.
 *
 * Every figure the venue reports rides ONE horizontally scrolling strip. Funding and open interest
 * used to fold behind a "More" button, which hid the cost of holding a position from the person
 * holding it — a figure a leveraged trader has to click for is a figure they will not read. The
 * strip scrolls HORIZONTALLY only; the header never grows a vertical scroll.
 */
export interface ChartHeaderProps {
  symbol: string
  /** The connection whose markets the switcher browses. */
  connectionId: string
  /** The CONNECTION's name (or the exchange id) — never the tab title, which repeats the symbol. */
  venue: string
  summary: MarketSummary
  market: Market | null | undefined
  precisionMode: PrecisionMode
  funding: FundingRate | null
  openInterest: OpenInterest | null
  /** Picking a market in the switcher opens/focuses its chart tab. */
  onSelectMarket: (market: Market) => void
}

/**
 * What window a figure actually measures. A venue-reported figure is the venue's own 24h rolling
 * stat; a figure derived from the loaded candles measures only as far back as they reach — the
 * initial history is intentionally bounded and older bars load on demand. Naming that `24h` would
 * be a claim about the market.
 */
function spanLabel(derived: boolean, windowSeconds: number | null): string {
  return derived && windowSeconds != null ? formatSpan(windowSeconds) : '24h'
}

/** How long a tick's tint lingers before fading out. Long enough to catch the eye at a
 *  glance, short enough that a fast market reads as a pulse rather than a solid block. */
const TICK_FLASH_MS = 320

/**
 * The DIRECTION of the latest tick — up, down, or nothing to say. A trader reads the tape by
 * its flashes, so the last price pulses green/red as it moves; the number alone changes too
 * quietly to notice. Returns null (no flash) under `prefers-reduced-motion`: a tint that snaps
 * on and off with no transition is a hard blink, which is exactly what that preference asks us
 * not to do, so the whole affordance is dropped rather than made abrupt.
 */
function useTickFlash(last: number | null | undefined): 'up' | 'down' | null {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const previous = useRef(last)
  useEffect(() => {
    const before = previous.current
    previous.current = last
    if (last == null || before == null || last === before) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setFlash(last > before ? 'up' : 'down')
    const id = setTimeout(() => setFlash(null), TICK_FLASH_MS)
    return () => clearTimeout(id)
  }, [last])
  return flash
}

export function ChartHeader({
  symbol,
  connectionId,
  venue,
  summary,
  market,
  precisionMode,
  funding,
  openInterest,
  onSelectMarket,
}: ChartHeaderProps) {
  // The chat a clicked stat asks — the chart tab's own. Without one the stats are not buttons.
  const sessionId = useWorkItemSessionId()
  const [pickerOpen, setPickerOpen] = useState(false)
  const tick = useTickFlash(summary.last)
  const price = (v: number | null | undefined) => formatPrice(v ?? null, market, precisionMode)
  const rangeLabel = spanLabel(summary.highLowFromCandles, summary.windowSeconds)
  const volLabel = spanLabel(
    summary.baseVolume != null && summary.baseVolumeFromCandles,
    summary.windowSeconds,
  )
  // A quote-volume figure counts the quote currency; a base-volume figure counts whichever unit its
  // SOURCE counted in (see `baseVolumeUnitLabel`). Either way the unit is spelled out beside it.
  const volUnit =
    summary.baseVolume != null ? baseVolumeUnitLabel(summary, market) : (market?.quote ?? '')
  const change = formatPercent(summary.change)
  const changeTone =
    change.sign > 0
      ? 'text-status-success'
      : change.sign < 0
        ? 'text-status-error'
        : 'text-text-soft'

  return (
    <header className="flex min-h-[5rem] items-stretch gap-4 border-b border-border-soft px-4 py-2.5">
      {/* Identity, then the price. The symbol is a switcher button; the line beneath names the
          connection, not the tab. */}
      <div className="flex min-w-0 shrink-0 flex-col justify-center">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          title="Switch market"
          className="group -ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-surface-hover focus-ring"
        >
          <span className="truncate text-base font-semibold leading-tight text-foreground">
            {symbol}
          </span>
          {/* Delisted / halted — keep the historical chart visible, but never present the market as
              currently active. */}
          {market && marketInactiveBadge(market) && (
            <span
              className="shrink-0 rounded-sm bg-status-warning/15 px-1 text-3xs font-medium uppercase tracking-wide text-status-warning"
              title="Delisted or halted — data may be historical"
            >
              inactive
            </span>
          )}
          <ChevronsUpDown
            aria-hidden="true"
            className="size-3 shrink-0 text-text-faint transition-colors group-hover:text-text-soft"
          />
        </button>
        <span className="mt-0.5 truncate px-1 text-2xs leading-tight text-text-faint">{venue}</span>
      </div>

      <div
        className={cn(
          'flex shrink-0 flex-col justify-center border-l-2 pl-3',
          summary.change && summary.change > 0
            ? 'border-l-status-success/60'
            : summary.change && summary.change < 0
              ? 'border-l-status-error/60'
              : 'border-l-border-soft',
        )}
      >
        <span className="text-2xs uppercase leading-tight tracking-wider text-text-faint">
          Last price
        </span>
        {/* The tick pulse tints the price's own box, not the glyphs: recoloring the number would
            fight the change tone it already carries (a green price in a red day is a lie). */}
        <span
          className={cn(
            '-mx-1 w-fit rounded-md px-1 text-xl font-semibold leading-tight tabular-nums transition-colors duration-(--dur-base)',
            changeTone,
            tick === 'up'
              ? 'bg-status-success/20'
              : tick === 'down'
                ? 'bg-status-error/20'
                : 'bg-transparent',
          )}
        >
          {price(summary.last)}
        </span>
        {/* How far it moved, in points AND percent. On a 7,527 index `+0.36%` is 27 points, and the
            points are what a trader sizes a stop against. */}
        <span
          className={cn('mt-0.5 text-2xs leading-tight tabular-nums', changeTone)}
          title={`Change over ${spanLabel(summary.changeFromCandles, summary.windowSeconds)}`}
        >
          {summary.changeAbs != null &&
            `${summary.changeAbs > 0 ? '+' : ''}${price(summary.changeAbs)} `}
          {change.text}
        </span>
      </div>

      <div className="scrollbar-thin flex min-w-0 flex-1 items-stretch gap-5 overflow-x-auto overflow-y-hidden border-l border-border-soft pl-4">
        {/* Every figure the venue reports, in one scrolling strip. A perpetual liquidates and funds
            against MARK, not the last trade, and mark tracks the index — neither is `last`, and
            neither is optional to a leveraged position. Funding and open interest were once folded
            behind a "More" button, which hid the cost of holding the position from the person
            holding it. A figure the venue did not report is simply absent. */}
        {funding?.markPrice != null && (
          <Stat
            label="Mark"
            title="The price this contract is marked at — what liquidation and funding are computed against, not the last trade."
          >
            {price(funding.markPrice)}
          </Stat>
        )}
        {funding?.indexPrice != null && (
          <Stat label="Index" title="The underlying reference price the mark tracks.">
            {price(funding.indexPrice)}
          </Stat>
        )}
        {(summary.baseVolume ?? summary.quoteVolume) != null && (
          <Stat
            // Name the unit: base volume counts coins, quote volume counts dollars, and they differ
            // by four orders of magnitude on a cheap asset.
            label={`${volLabel} ${summary.baseVolume != null ? 'vol' : 'quote vol'}`}
            title={
              summary.baseVolume != null && !summary.baseVolumeFromCandles
                ? "The venue's own 24h count. ccxt does not convert it, so on a contract market it counts contracts."
                : undefined
            }
          >
            {formatCompactVolume(summary.baseVolume ?? summary.quoteVolume)}
            {/* The figure has two sources with two units — the venue's own ticker count (contracts on
                a contract market) or a base-currency sum over the candles. Nothing about the number
                says which, so the unit is named. */}
            {volUnit ? <span className="ml-1 text-text-faint">{volUnit}</span> : null}
          </Stat>
        )}

        {(() => {
          // One RANGE cell: low ——●—— high with the marker at the last price's position. A lone
          // "79%" beside a bare dot was unreadable — the endpoints are the context that makes it a
          // range, and the percentage lives in the tooltip. Falls back to plain high/low stats when
          // the range has no width (nothing to place a marker within).
          const pos = rangePosition(summary.last, summary.high, summary.low)
          if (pos === null || summary.high == null || summary.low == null) {
            return (
              <>
                {summary.high != null && (
                  <Stat label={`${rangeLabel} high`}>{price(summary.high)}</Stat>
                )}
                {summary.low != null && (
                  <Stat label={`${rangeLabel} low`}>{price(summary.low)}</Stat>
                )}
              </>
            )
          }
          const near = pos >= 0.85 ? 'high' : pos <= 0.15 ? 'low' : null
          // The SAME two-line label/value column as every other Stat cell — a label over one
          // "low – high" line — so it aligns with its neighbours instead of running taller (a third
          // bar line made it center higher than the 2-line cells). The last price's position within
          // the range lives in the tooltip; the endpoint nearest it is tinted as the cue.
          return (
            <div
              className="flex shrink-0 flex-col justify-center"
              title={`The last price sits ${Math.round(pos * 100)}% of the way from the ${rangeLabel} low to the high (0% = low, 100% = high).`}
            >
              <span className="whitespace-nowrap text-2xs uppercase leading-tight tracking-wider text-text-faint">
                {rangeLabel} range
              </span>
              <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-xs leading-tight tabular-nums">
                <span className={near === 'low' ? 'text-status-success' : 'text-text-soft'}>
                  {price(summary.low)}
                </span>
                <span className="text-text-faint">–</span>
                <span className={near === 'high' ? 'text-status-error' : 'text-text-soft'}>
                  {price(summary.high)}
                </span>
              </span>
            </div>
          )
        })()}
        {funding && (
          <Stat
            label="Funding"
            title={
              // The sign is who pays whom; the period is what makes the number actionable. Neither
              // fits a header cell, and dropping either would leave a number nobody can act on.
              (funding.rate > 0
                ? 'Longs pay shorts'
                : funding.rate < 0
                  ? 'Shorts pay longs'
                  : 'No payment') +
              (funding.interval
                ? ` every ${funding.interval}`
                : ' (the venue did not report its funding period)') +
              (funding.nextFundingTime
                ? `. Next settlement ${new Date(funding.nextFundingTime).toLocaleString()}`
                : '') +
              '. Click to ask the agent.'
            }
            tone={
              funding.rate > 0
                ? 'text-status-error'
                : funding.rate < 0
                  ? 'text-status-success'
                  : undefined
            }
            sub={<Countdown at={funding.nextFundingTime} />}
            // The carry cost is the figure a leveraged holder most often wants EXPLAINED — a
            // click hands it to the agent with the live `funding` leaf linked (askAgent pattern).
            onClick={
              sessionId
                ? () =>
                    askAgent(
                      sessionId,
                      buildCarryStatPrefill(
                        { connectionId, symbol },
                        {
                          label: 'funding',
                          value: formatFundingRate(funding.rate, funding.interval),
                        },
                      ),
                    )
                : undefined
            }
          >
            {formatFundingRate(funding.rate, funding.interval)}
          </Stat>
        )}
        {openInterest?.amount != null && (
          <Stat
            label="Open interest"
            title="Total size of all open positions in this contract, in the unit the venue counts. Click to ask the agent."
            onClick={
              sessionId
                ? () =>
                    askAgent(
                      sessionId,
                      buildCarryStatPrefill(
                        { connectionId, symbol },
                        {
                          label: 'open interest',
                          value:
                            formatCompactVolume(openInterest.amount) +
                            (sizeUnit(market).label ? ` ${sizeUnit(market).label}` : ''),
                        },
                      ),
                    )
                : undefined
            }
          >
            {formatCompactVolume(openInterest.amount)}
            {/* The venue counts open interest in CONTRACTS (ccxt `openInterestAmount` is OKX's `oi`,
                not `oiCcy`). On a `contractSize: 1` market that unit IS the base currency. */}
            {sizeUnit(market).label ? (
              <span className="ml-1 text-text-faint">{sizeUnit(market).label}</span>
            ) : null}
          </Stat>
        )}
      </div>

      <MarketPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        connectionId={connectionId}
        currentSymbol={symbol}
        onSelect={onSelectMarket}
      />
    </header>
  )
}

/**
 * One `label` / `value` column. The label sits above the figure and is the quiet element: a trader
 * scans the numbers and reads a caption only when one surprises them. `sub` carries a second, even
 * quieter line (the funding countdown) without inventing a second column for it.
 *
 * With `onClick` the column renders as a BUTTON (an ask-agent affordance — funding, open
 * interest): same layout, hover tint and a focus ring, so the strip stays scannable and the
 * clickable cells are still keyboard-reachable.
 */
function Stat({
  label,
  title,
  tone,
  sub,
  onClick,
  children,
}: {
  label: string
  title?: string
  tone?: string
  sub?: React.ReactNode
  onClick?: () => void
  children: React.ReactNode
}) {
  const body = (
    <>
      <span className="whitespace-nowrap text-2xs uppercase leading-tight tracking-wider text-text-faint">
        {label}
      </span>
      <span
        className={cn('whitespace-nowrap text-xs leading-tight tabular-nums text-text-soft', tone)}
      >
        {children}
        {sub}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="-mx-1 flex shrink-0 flex-col justify-center rounded-md px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-ring"
      >
        {body}
      </button>
    )
  }
  return (
    <div className="flex shrink-0 flex-col justify-center" title={title}>
      {body}
    </div>
  )
}

/**
 * Time to the next funding settlement, ticking. Renders nothing when the venue reported no
 * settlement time, or when it has passed — a frozen `0s` claims a settlement that is not happening.
 */
function Countdown({ at }: { at: number | undefined }) {
  const now = useSecondTick(at !== undefined)

  const text = at === undefined ? null : formatCountdown(at - now)
  return text ? <span className="ml-1.5 text-text-faint">{text}</span> : null
}

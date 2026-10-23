/**
 * "Ask agent" — route a question about something ON the market surface through the NORMAL chat,
 * the shared workbench pattern: prefill the composer with the surface's
 * `@resource:localix://resource/trade/…` token (so the agent re-reads the LIVE leaf via ref expansion, not a
 * stale screenshot of it) plus one human line naming the thing that was clicked, ending in
 * "— " for the user's own question. The user reviews, types, and sends.
 *
 * Why a resource ref and not the numbers on screen: the token is minted by `buildTradeUri`,
 * the one owner of this mini app's URI grammar, so what the click links can never drift from
 * what the backend's resource provider resolves — the same invariant the side-panel tab drag
 * relies on. The human line DOES carry the clicked figures (formatted exactly as the screen
 * showed them), because "the wall at 63,900" is the question's subject; the ref is how the
 * agent checks whether it is still there.
 *
 * Pure text-building is kept separate from the bus side effect so it unit-tests directly,
 * exactly like `askAgentAboutResponse.ts`'s split.
 */
import { miniAppComposer } from '@localixai/mini-app-sdk/ui/runtime'
import { buildTradeUri, type MarketLeaf } from '../../backend/uri'

export interface MarketSurfaceRef {
  connectionId: string
  symbol: string
}

export interface AskAgentPrefill {
  /** The composer text: `@resource:` token, blank line, the human line ending in "— ". */
  text: string
}

/** The shared shape: token line, blank line, subject line inviting the question. */
function prefill(ref: MarketSurfaceRef, leaf: MarketLeaf, subject: string): AskAgentPrefill {
  const token = buildTradeUri({
    kind: 'marketLeaf',
    connectionId: ref.connectionId,
    symbol: ref.symbol,
    leaf,
  })
  return { text: `@resource:${token}\n\n${subject} — ` }
}

/**
 * A clicked order-book level: `BTC/USDC:USDC bid wall at 63,900 (12.4 BTC resting) — `.
 * Price/size arrive FORMATTED (the exact strings the ladder rendered) so the prefill and the
 * screen can never disagree about a number; the size clause is dropped when the caller has
 * none to show. Links the `orderbook` leaf — the wall's own address.
 */
export function buildBookLevelPrefill(
  ref: MarketSurfaceRef,
  level: { side: 'bid' | 'ask'; price: string; size?: string; sizeUnit?: string },
): AskAgentPrefill {
  const resting = level.size
    ? ` (${level.size}${level.sizeUnit ? ` ${level.sizeUnit}` : ''} resting)`
    : ''
  return prefill(ref, 'orderbook', `${ref.symbol} ${level.side} wall at ${level.price}${resting}`)
}

/**
 * A clicked tape print: `BTC/USDC:USDC sell print 0.52 BTC @ 63,901 (12:03:11) — `.
 * `trades` is the venue-wide tape leaf, never the account's own `fills`.
 */
export function buildTapePrintPrefill(
  ref: MarketSurfaceRef,
  print: {
    side: 'buy' | 'sell'
    price: string
    size: string
    sizeUnit?: string
    time?: string
    /** Aggressor imbalance over the loaded prints — the flow context the trader is looking at. */
    flow?: { buyPct: number; prints: number }
  },
): AskAgentPrefill {
  const unit = print.sizeUnit ? ` ${print.sizeUnit}` : ''
  const when = print.time ? ` (${print.time})` : ''
  const flow = print.flow
    ? ` — recent flow ${print.flow.buyPct}% buy / ${100 - print.flow.buyPct}% sell over the last ${print.flow.prints} prints`
    : ''
  return prefill(
    ref,
    'trades',
    `${ref.symbol} ${print.side} print ${print.size}${unit} @ ${print.price}${when}${flow}`,
  )
}

/**
 * A clicked funding / open-interest stat: `BTC/USDC:USDC funding 0.0100% / 8h — `. Both stats
 * link the `funding` leaf — the instrument's public carry (rate + open interest live together
 * there, so either question hands the agent both figures).
 */
export function buildCarryStatPrefill(
  ref: MarketSurfaceRef,
  stat: { label: 'funding' | 'open interest'; value: string },
): AskAgentPrefill {
  return prefill(ref, 'funding', `${ref.symbol} ${stat.label} ${stat.value}`)
}

/**
 * Put a prefill in the composer of the chat the clicked surface belongs to. Appends (never
 * replaces) so a half-typed draft is not clobbered — the same stance every composerBus caller
 * holds.
 *
 * The chat is named, not assumed: the insert used to go to whichever composer had focus, so a
 * chart kept open for chat A put its question into chat B's draft once the person switched.
 */
export function askAgent(sessionId: string, p: AskAgentPrefill): void {
  miniAppComposer.insert({ sessionId, text: p.text })
}

/* ------------------------------- AI technical analysis ------------------------------- */

export type AnalysisStyle = 'scalp' | 'intraday' | 'swing' | 'position'
export type AnalysisBias = 'auto' | 'long' | 'short'
export type AnalysisRisk = 'conservative' | 'balanced' | 'aggressive'
/** The playbook the plan is judged against — the classic, battle-tested trade archetypes. */
export type AnalysisStrategy = 'auto' | 'trend' | 'breakout' | 'meanrev'

export interface AnalysisRequest {
  /** The chart's current timeframe token (`5m`, `1h`, …) — the analysis anchors to it. */
  timeframe?: string
  style: AnalysisStyle
  strategy: AnalysisStrategy
  bias: AnalysisBias
  risk: AnalysisRisk
  /** Canonical ids currently on the chart, so the agent refines rather than duplicates. */
  activeIndicators: string[]
  /** When set, the plan is tailored to counter the trader's flagged behavioral biases (the agent
   *  checks recent behavior via the trade_history tool). */
  biasAware?: boolean
}

const STYLE_LINES: Record<AnalysisStyle, string> = {
  scalp: 'scalp (minutes; fast in/out on the lowest timeframes)',
  intraday: 'intraday (opened and closed within the day)',
  swing: 'swing (held for days)',
  position: 'position (held for weeks; higher-timeframe structure rules)',
}

/**
 * Playbook rules distilled from the parts of trading research that replicate: time-series
 * momentum (Moskowitz/Ooi/Pedersen 2012) for trend, short-term reversal in non-trending
 * regimes (Connors-style RSI-2 / %B) for mean-reversion, volatility-compression breakouts
 * (Donchian / Turtle lineage, squeeze) for breakout — each with the REGIME FILTER that the
 * evidence says separates the edge from noise (trend tools lose in ranges and vice versa).
 */
const STRATEGY_LINES: Record<AnalysisStrategy, string> = {
  auto: 'FIRST classify the regime (trending if ADX(14) > 25 and EMAs are stacked; ranging if ADX < 20 inside a defined range; compressing if Bollinger width sits near its recent lows), then run the matching playbook — trend-following, mean-reversion, or breakout — and SAY which one and why',
  trend:
    'trend-following (time-series momentum) — trade ONLY in the direction of the dominant trend (EMA 20/50/200 stacked, ADX(14) > 20–25); enter on pullbacks to value (EMA20/50 zone or prior structure), never counter-trend, and stand aside if the trend filter fails',
  breakout:
    'volatility breakout — a REAL setup needs compression first (Bollinger width near recent lows / a tight Donchian range); enter only on a confirmed close through the range boundary with expanding volume, prefer breaks in the higher-timeframe trend direction; a close back inside the range is a failed break — exit, do not argue',
  meanrev:
    'mean-reversion — valid ONLY in a non-trending regime (ADX(14) < 20, price inside a defined range); fade extensions at the range edge / outer Bollinger band back toward the mean (basis), target the middle not the far edge, hard stop beyond the range boundary; if the regime is trending, this playbook is OFF',
}

/**
 * The indicator kit each playbook reads best with — added to the chart (not substituted) when
 * the wizard's "set up chart" toggle is on, and named in the task so the agent works WITH the
 * visible chart instead of re-deriving it.
 */
export const STRATEGY_INDICATORS: Record<Exclude<AnalysisStrategy, 'auto'>, readonly string[]> = {
  trend: ['ema:20', 'ema:50', 'ema:200', 'adx:14', 'atr:14'],
  breakout: ['donchian:20', 'bbw:20:2', 'obv', 'atr:14'],
  meanrev: ['bb:20:2', 'rsi:14', 'stoch:14:3:3', 'atr:14'],
}

/**
 * The risk profile as HARD numbers, not adjectives — per-trade risk cap and the minimum
 * risk:reward a setup must clear to be worth taking. Shown in the wizard and enforced in the
 * task text, so "aggressive" can never quietly mean "no rules".
 */
export const RISK_RULES: Record<
  AnalysisRisk,
  { perTradePct: number; minRR: string; line: string }
> = {
  conservative: {
    perTradePct: 0.5,
    minRR: '1:3',
    line: 'risk at most 0.5% of equity per trade; take only A-grade setups at risk:reward 1:3 or better; when in doubt, stay flat',
  },
  balanced: {
    perTradePct: 1,
    minRR: '1:2',
    line: 'risk at most 1% of equity per trade; discard any setup below risk:reward 1:2',
  },
  aggressive: {
    perTradePct: 2,
    minRR: '1:1.5',
    line: 'risk at most 2% of equity per trade; minimum risk:reward 1:1.5 — wider stops and earlier entries are acceptable, position size scales DOWN to keep the 2% cap',
  },
}

/**
 * The AI-analysis wizard's task text — a COMPLETE instruction (not an open "— " question),
 * structured as the checklist a disciplined desk runs: regime → levels → confirmations →
 * both scenarios with entry/stop/targets → sizing → no-trade conditions. Sent as a normal
 * chat message, so the whole run stays reviewable in the thread. Scenario analysis only —
 * it explicitly forbids placing orders.
 */
export function buildTechnicalAnalysisPrefill(
  ref: MarketSurfaceRef,
  req: AnalysisRequest,
): AskAgentPrefill {
  const token = buildTradeUri({
    kind: 'marketLeaf',
    connectionId: ref.connectionId,
    symbol: ref.symbol,
    leaf: 'candles',
  })
  const tf = req.timeframe ? ` on the ${req.timeframe} timeframe` : ''
  const risk = RISK_RULES[req.risk]
  const bias =
    req.bias === 'auto'
      ? 'no directional bias — decide long/short/flat from the data'
      : `check my ${req.bias.toUpperCase()} bias against the data and say plainly if it does not hold`
  const active =
    req.activeIndicators.length > 0
      ? `The chart shows: ${req.activeIndicators.join(', ')} — read them, keep what helps, adjust via the chart tools if something is missing.`
      : 'The chart has no indicators yet — enable the set that fits this playbook via the chart tools first.'
  return {
    text: [
      `@resource:${token}`,
      '',
      `Run a full technical analysis of ${ref.symbol}${tf} for a ${STYLE_LINES[req.style]} trade.`,
      `Playbook: ${STRATEGY_LINES[req.strategy]}.`,
      `Bias: ${bias}.`,
      `Risk rules (hard constraints): ${risk.line}.`,
      active,
      '',
      'Work through this checklist, in order:',
      '1. Run manage_chart action="detect" with auto_draw FIRST — it returns the market REGIME (trending/ranging/compressing), a composite Trend/Momentum/Volume signal with a suggested-exposure figure, confluence zones, the full SMC set (structure BOS/ChoCH, unfilled fair value gaps, unmitigated order blocks, liquidity pools with a JUST-SWEPT flag), the volume profile (POC + premium/discount vs the value area), session VWAP, support/resistance levels, candlestick flags, RSI divergence, a cloud-gated Ichimoku read, any completed harmonic pattern (its D is a Potential Reversal Zone), ATR/HV-percentile volatility, per-bar VaR/CVaR, and — on a perp — the funding-rate positioning read plus an order-book spread/imbalance snapshot, all with numbers. Start from its regime verdict; confirm this playbook is the right one for it (trend-following needs trending, mean-reversion needs ranging, breakout needs compressing) and say so if they disagree.',
      '2. Structure & timeframe fit: the higher-timeframe context and the swing highs/lows that matter. Let detect’s structure state set the directional bias — a BOS confirms the trend to trade WITH; a ChoCH warns the trend may be reversing, so favour the new direction or stand aside rather than fighting it. A LIQUIDITY SWEEP that just printed (wick through equal extremes, close back) is the classic stop-grab reversal tell — weigh it beside the ChoCH. On a perp, extreme funding is the crowded side: be reluctant to JOIN a side that is paying heavily to stay in. If the chart timeframe does not fit the style (scalp ≈ 1–5m, intraday ≈ 5–15m, swing ≈ 1h–4h, position ≈ 4h–1D), say so and anchor the plan to the style’s natural timeframe.',
      '3. Levels — DISCIPLINE MATTERS: PRIORITIZE detect’s CONFLUENCE zones (where several methods — S/R, Fibonacci, pivots, round numbers — agree); those are the strongest references and the plan’s entries, stops and targets should anchor to them over any single-method level. detect already drew its baseline; hand-draw at most 2–3 levels it missed. Levels within ~0.2% are ONE zone, one line. Hard cap: ~3 support + 3 resistance lines total on the chart. Labels ≤ 2 short words, NO price in the label (the axis shows it). Justify each level you keep; remove clutter you did not.',
      '4. Indicator read: reconcile your narrative with detect’s composite signal — if your read disagrees with the vote, explain WHY (do not ignore it); name confirmations AND conflicts, a conflicting signal is named, never dropped.',
      '5. Long and short scenarios SEPARATELY: entry trigger (what exactly must print) — favour entries where price is returning into an unfilled fair value gap, an unmitigated order block or a confluence zone (imbalances, institutional footprints and method-agreement are where reactions are strongest — a completed harmonic’s PRZ counts too), let the volume value area bias the direction (a discount favours longs, a premium favours shorts; the POC is a natural magnet), and use the order-book lean only for entry TIMING, never as a level. stop-loss behind the invalidating swing/level PLUS an ATR(14) noise buffer (~0.25–0.5 ATR) — never an arbitrary %, TP1/TP2 at real structure (prefer a confluence zone, the POC, or an opposing fair value gap as a target — price reacts hardest where methods agree), and the resulting risk:reward. Discard any scenario below the required minimum. Standard management: take partial at TP1, move the stop to break-even, trail the rest.',
      `6. Position sizing (volatility-adjusted): size = equity × ${risk.perTradePct}% ÷ stop distance — the stop sets the size, never the other way. Scale that risk budget by detect’s suggested-exposure figure (conviction-scaled): full agreement earns the full ${risk.perTradePct}%, a split vote proportionally less — a continuous size, not a binary call, and never above the cap. Then apply the volatility overlay: if detect’s HV percentile reads STRETCHED (≥80th), halve the exposure — reducing size when volatility is elevated improves risk-adjusted returns (volatility-managed sizing, Moreira & Muir 2017); a squeeze (≤20th) is NOT a licence to exceed the cap, it only warns an expansion is statistically nearer. Note leverage/liquidation implications if this is a perp (liquidation must sit well beyond the stop). If the account already holds a position CORRELATED with this market (the portfolio tool flags concentration), the new trade adds to ONE effective position — draw both from the same risk budget, not two.`,
      '7. No-trade conditions: state plainly what would make waiting the best position. No setup clearing the risk:reward bar IS a finding.',
      ...(req.biasAware
        ? [
            '8. Personalize: check my recent trading behavior with the trade_history tool. If it flags a behavioral bias (disposition effect = riding losers, overtrading, or anchoring), tailor the plan to counter it — a hard mechanical stop and pre-committed exit for disposition, a higher setup-quality bar and fewer entries for overtrading, a fresh objective read for anchoring. Name the bias and how the plan answers it.',
          ]
        : []),
      '',
      'Discipline: cite the specific number behind every claim (an indicator value, a level, a distance) — never assert a metric you did not read; always state the bear case even when leaning long (and vice versa); if the data is insufficient for a step, say so rather than inventing it.',
      'Finish with a one-line verdict: enter now / wait for a specific level / stay flat.',
      'If the verdict is "enter now", DRAW the plan on the chart with manage_chart: the entry, the stop and TP1/TP2 as labelled hlines (short labels — "Entry", "Stop", "TP1", "TP2"), so the setup is visual, not just described. Keep it to those lines; do not re-draw the structure you already marked.',
      'This is scenario analysis — do NOT place, modify, or cancel any orders.',
    ].join('\n'),
  }
}

/** Send an analysis request as a chat message immediately (the wizard's "Analyze" action).
 *  `internal`: the machine-composed task text is HIDDEN in the transcript (the model still sees
 *  it) — the user picked their intent in the wizard's controls, not by typing this wall of text.
 *  Submitted in `sessionId`, the chart's own chat — see {@link askAgent}. */
export function runAnalysis(sessionId: string, ref: MarketSurfaceRef, req: AnalysisRequest): void {
  miniAppComposer.insert({
    sessionId,
    text: buildTechnicalAnalysisPrefill(ref, req).text,
    submit: true,
    internal: true,
  })
}

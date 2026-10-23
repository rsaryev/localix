import { useEffect, useState } from 'react'
import {
  ArrowLeftRight,
  Compass,
  Shield,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { tonedIcon, type IconComponent, type MenuEntry } from '@localixai/plugin-sdk/ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { loadAnalysisPrefs, saveAnalysisPrefs } from '../model/analysisPrefs'
import { chartToggleChip } from './chartToggleChip'
import {
  RISK_RULES,
  STRATEGY_INDICATORS,
  runAnalysis,
  type AnalysisBias,
  type AnalysisRisk,
  type AnalysisStrategy,
  type AnalysisStyle,
} from '../model/askAgent'

/**
 * "Analyze" — the AI technical-analysis request, the third control in the chart's top-right
 * cluster beside the chart-type and indicator menus (whose trigger it mirrors). Four picks a
 * trade plan cannot be written without (style, playbook, directional bias, risk), two toggles,
 * then ONE action: the composed task is sent to the agent at once, which sets the chart up via
 * the chart tools and answers with entries/TP/SL in the thread.
 *
 * It was a popover FORM: four labelled segmented rows, two checkboxes and a pinned button, under
 * a live "current read" block. The segments squeezed four options into a 20rem column, each pick
 * looked unlike every other pick in the app, and the read block — regime, bias, structure, VWAP,
 * value area, volatility, divergence, the timeframe dots — was a second copy of the Technicals
 * tab's lenses, computed from the same candles by the same `computeChartRead`, one click away in
 * the same cluster (the gauge button). So it is the app's menu (`MenuEntries`, the plan's Approve
 * menu's shape): each pick a submenu row whose `hint` is the current answer and whose options are
 * `selected` + `keepOpen` (choosing steps back to the rows, so the answer shows before asking);
 * each option's meaning is its `description`; the toggles are `checked` rows; "Ask agent" closes
 * it. The read lives on the Technicals tab only — one owner, and the agent reads the market
 * itself before it answers.
 */

export interface AnalysisMarket {
  connectionId: string
  symbol: string
  /** The chart's CURRENT timeframe token (`5m`, `1h`, …). */
  timeframe?: string
}

interface Option<T extends string> {
  value: T
  label: string
  description: string
  icon?: IconComponent
}

const STYLES: ReadonlyArray<Option<AnalysisStyle>> = [
  { value: 'scalp', label: 'Scalp', description: 'Minutes; fast in and out on low timeframes' },
  { value: 'intraday', label: 'Intraday', description: 'Opened and closed within the day' },
  { value: 'swing', label: 'Swing', description: 'Held for days' },
  { value: 'position', label: 'Position', description: 'Held for weeks; higher timeframes rule' },
]

const STRATEGIES: ReadonlyArray<Option<AnalysisStrategy>> = [
  { value: 'auto', label: 'Auto', description: 'Classify the regime, then pick the playbook' },
  { value: 'trend', label: 'Trend', description: 'With the dominant trend, entered on pullbacks' },
  {
    value: 'breakout',
    label: 'Breakout',
    description: 'Compression first, then a confirmed close through the range',
  },
  {
    value: 'meanrev',
    label: 'Mean-rev',
    description: 'Fade range extremes back to the mean; off in a trend',
  },
]

const BIASES: ReadonlyArray<Option<AnalysisBias>> = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Decide long, short or flat from the data',
    icon: ArrowLeftRight,
  },
  {
    value: 'long',
    label: 'Long',
    description: 'Check a long bias against the data',
    icon: tonedIcon(TrendingUp, 'success'),
  },
  {
    value: 'short',
    label: 'Short',
    description: 'Check a short bias against the data',
    icon: tonedIcon(TrendingDown, 'error'),
  },
]

const RISK_LABEL: Record<AnalysisRisk, string> = {
  conservative: 'Careful',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
}

/** The profile as hard numbers — the same rules the task text enforces. */
const RISKS: ReadonlyArray<Option<AnalysisRisk>> = (
  ['conservative', 'balanced', 'aggressive'] as const
).map((value) => ({
  value,
  label: RISK_LABEL[value],
  description: `≤${RISK_RULES[value].perTradePct}% risk per trade · min R:R ${RISK_RULES[value].minRR}`,
}))

/** One pick as a submenu row: its current answer as the hint, its options as `selected` rows. */
function pickEntry<T extends string>(
  id: string,
  label: string,
  icon: IconComponent,
  options: ReadonlyArray<Option<T>>,
  value: T,
  onChange: (value: T) => void,
): MenuEntry {
  return {
    id,
    label,
    icon,
    hint: options.find((option) => option.value === value)?.label,
    items: options.map((option) => ({
      id: `${id}:${option.value}`,
      label: option.label,
      description: option.description,
      icon: option.icon,
      selected: option.value === value,
      keepOpen: true,
      onSelect: () => onChange(option.value),
    })),
  }
}

export function ChartAnalysisMenu({
  market,
  activeIndicators,
  onApplyIndicators,
}: {
  market: AnalysisMarket
  activeIndicators: string[]
  /** ADD these canonical ids to the chart (the strategy kit) — the "set up chart" toggle. */
  onApplyIndicators: (ids: readonly string[]) => void
}) {
  // The chat this chart's tab belongs to — the analysis is submitted THERE, never to the chat
  // that happens to be on screen.
  const sessionId = useWorkItemSessionId()
  const [open, setOpen] = useState(false)
  // Seed from the last-used settings (global habit); persisted below so a repeat user keeps them.
  const [prefs] = useState(loadAnalysisPrefs)
  const [style, setStyle] = useState<AnalysisStyle>(prefs.style)
  const [strategy, setStrategy] = useState<AnalysisStrategy>(prefs.strategy)
  const [bias, setBias] = useState<AnalysisBias>(prefs.bias)
  const [risk, setRisk] = useState<AnalysisRisk>(prefs.risk)
  const [setupChart, setSetupChart] = useState(prefs.setupChart)
  const [biasAware, setBiasAware] = useState(prefs.biasAware)
  const kit = strategy === 'auto' ? null : STRATEGY_INDICATORS[strategy]
  // Persist the settings whenever any changes — the next open restores them.
  useEffect(() => {
    saveAnalysisPrefs({ style, strategy, bias, risk, setupChart, biasAware })
  }, [style, strategy, bias, risk, setupChart, biasAware])

  const ask = () => {
    if (!sessionId) return
    // Put the playbook's kit on the chart FIRST, so the task's "the chart shows …" claim is true
    // by the time the agent reads it.
    const applied = kit && setupChart ? kit : []
    if (applied.length > 0) onApplyIndicators(applied)
    const merged = [...new Set([...activeIndicators, ...applied])]
    runAnalysis(
      sessionId,
      { connectionId: market.connectionId, symbol: market.symbol },
      {
        timeframe: market.timeframe,
        style,
        strategy,
        bias,
        risk,
        activeIndicators: merged,
        biasAware,
      },
    )
  }

  const entries: MenuEntry[] = [
    { header: market.timeframe ? `${market.symbol} · ${market.timeframe}` : market.symbol },
    pickEntry('style', 'Style', Timer, STYLES, style, setStyle),
    pickEntry('strategy', 'Playbook', Target, STRATEGIES, strategy, setStrategy),
    pickEntry('bias', 'Bias', Compass, BIASES, bias, setBias),
    pickEntry('risk', 'Risk', Shield, RISKS, risk, setRisk),
    { separator: true },
    ...(kit
      ? [
          {
            id: 'setup-chart',
            label: 'Set up chart',
            description: kit.join(', '),
            checked: setupChart,
            keepOpen: true,
            onSelect: () => setSetupChart(!setupChart),
          },
        ]
      : []),
    {
      id: 'bias-aware',
      label: 'Counter my trading biases',
      description: 'Checks recent trades for disposition, overtrading, anchoring',
      checked: biasAware,
      keepOpen: true,
      onSelect: () => setBiasAware(!biasAware),
    },
    { separator: true },
    {
      id: 'ask',
      label: 'Ask agent',
      icon: Sparkles,
      // No chat behind this chart means no agent to run it.
      description: sessionId
        ? 'Sets up the chart and answers with a trade plan'
        : 'No chat behind this chart',
      disabled: !sessionId,
      onSelect: ask,
    },
  ]

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="AI technical analysis"
          className={cn(
            'flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs outline-none transition-colors focus-ring',
            chartToggleChip(open),
          )}
        >
          <Sparkles className="size-3" />
          Analyze
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

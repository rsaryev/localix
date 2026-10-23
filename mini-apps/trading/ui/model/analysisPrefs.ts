import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader, StorageWriter } from '@localixai/mini-app-sdk/ui/storage'
import type { AnalysisBias, AnalysisRisk, AnalysisStrategy, AnalysisStyle } from './askAgent'

/**
 * The Analyze wizard's last-used settings, persisted GLOBALLY (how a trader analyses is their
 * habit, the same on every market — like the chart type and indicator set). Seeded on mount so a
 * repeat user does not re-pick their style/risk every time. Each field is validated against its
 * allowed set on load: a hand-edited or stale store falls back per-field, never throws.
 */
export interface AnalysisPrefs {
  style: AnalysisStyle
  strategy: AnalysisStrategy
  bias: AnalysisBias
  risk: AnalysisRisk
  /** Whether the "set up chart" toggle is on when a playbook has a kit. */
  setupChart: boolean
  /** Whether the plan should be tailored to counter the trader's flagged behavioral biases. */
  biasAware: boolean
}

const STYLES: readonly AnalysisStyle[] = ['scalp', 'intraday', 'swing', 'position']
const STRATEGIES: readonly AnalysisStrategy[] = ['auto', 'trend', 'breakout', 'meanrev']
const BIASES: readonly AnalysisBias[] = ['auto', 'long', 'short']
const RISKS: readonly AnalysisRisk[] = ['conservative', 'balanced', 'aggressive']

export const DEFAULT_ANALYSIS_PREFS: AnalysisPrefs = {
  style: 'intraday',
  strategy: 'auto',
  bias: 'auto',
  risk: 'balanced',
  setupChart: true,
  biasAware: false,
}

const KEY = 'localix.trading.analysisPrefs'

/** One field, validated against its allowed set — the stored value if valid, else the default. */
function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Load the wizard prefs, per-field validated. Any malformed field falls back; never throws. */
export function loadAnalysisPrefs(storage?: StorageReader): AnalysisPrefs {
  const raw = loadJSON<Partial<Record<keyof AnalysisPrefs, unknown>>>(KEY, storage)
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ANALYSIS_PREFS }
  return {
    style: pick(raw.style, STYLES, DEFAULT_ANALYSIS_PREFS.style),
    strategy: pick(raw.strategy, STRATEGIES, DEFAULT_ANALYSIS_PREFS.strategy),
    bias: pick(raw.bias, BIASES, DEFAULT_ANALYSIS_PREFS.bias),
    risk: pick(raw.risk, RISKS, DEFAULT_ANALYSIS_PREFS.risk),
    setupChart:
      typeof raw.setupChart === 'boolean' ? raw.setupChart : DEFAULT_ANALYSIS_PREFS.setupChart,
    biasAware:
      typeof raw.biasAware === 'boolean' ? raw.biasAware : DEFAULT_ANALYSIS_PREFS.biasAware,
  }
}

export function saveAnalysisPrefs(prefs: AnalysisPrefs, storage?: StorageWriter): void {
  saveJSON(KEY, prefs, storage)
}

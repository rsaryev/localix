import { beforeEach, describe, expect, it } from 'bun:test'
import {
  DEFAULT_ANALYSIS_PREFS,
  loadAnalysisPrefs,
  saveAnalysisPrefs,
  type AnalysisPrefs,
} from './analysisPrefs'

/** In-memory storage keeps this suite independent from concurrently running preference tests. */
class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('analysisPrefs', () => {
  let store: MemoryStorage

  beforeEach(() => {
    store = new MemoryStorage()
  })

  it('defaults when nothing is stored', () => {
    expect(loadAnalysisPrefs(store)).toEqual(DEFAULT_ANALYSIS_PREFS)
  })

  it('round-trips a full valid set', () => {
    const prefs: AnalysisPrefs = {
      style: 'swing',
      strategy: 'breakout',
      bias: 'long',
      risk: 'conservative',
      setupChart: false,
      biasAware: true,
    }
    saveAnalysisPrefs(prefs, store)
    expect(loadAnalysisPrefs(store)).toEqual(prefs)
  })

  it('falls back per-field on a malformed or partial store, never throws', () => {
    store.setItem(
      'localix.trading.analysisPrefs',
      JSON.stringify({ style: 'nonsense', bias: 'long', risk: 42, setupChart: 'yes' }),
    )
    const loaded = loadAnalysisPrefs(store)
    expect(loaded.style).toBe(DEFAULT_ANALYSIS_PREFS.style) // invalid → default
    expect(loaded.bias).toBe('long') // valid → kept
    expect(loaded.risk).toBe(DEFAULT_ANALYSIS_PREFS.risk) // invalid type → default
    expect(loaded.setupChart).toBe(DEFAULT_ANALYSIS_PREFS.setupChart) // non-boolean → default
  })
})

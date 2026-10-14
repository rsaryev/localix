import { describe, expect, test } from 'bun:test'
import { USAGE_AUXILIARY_KINDS, USAGE_KIND_LABELS } from '@localixai/api/client'

import {
  formatBucketLabel,
  formatDuration,
  formatLogDate,
  formatTokens,
  formatUsd,
  kindLabel,
  providerLabel,
  shortKey,
} from './format'

describe('formatUsd', () => {
  test('compact across magnitudes', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.0042)).toBe('$0.0042') // < 1¢ → 4dp
    expect(formatUsd(0.5)).toBe('$0.500') // < $1 → 3dp
    expect(formatUsd(1234.5)).toBe('$1,234.50') // ≥ $1 → grouped, 2dp
  })
})

describe('kindLabel', () => {
  test('renders every backend-owned usage kind from the shared contract', () => {
    for (const kind of ['turn', ...USAGE_AUXILIARY_KINDS] as const) {
      expect(kindLabel(kind)).toBe(USAGE_KIND_LABELS[kind])
    }
    expect(kindLabel('future-kind')).toBe('future-kind')
  })
})

describe('formatTokens', () => {
  test('k/M suffixes with thresholds', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(1_000_000)).toBe('1.00M')
    expect(formatTokens(2_500_000)).toBe('2.50M')
  })
})

describe('shortKey / providerLabel', () => {
  test('shortKey keeps the last two path segments', () => {
    expect(shortKey('')).toBe('unknown')
    expect(shortKey('unknown')).toBe('unknown')
    expect(shortKey('solo')).toBe('solo')
    expect(shortKey('openrouter/deepseek/deepseek-v4')).toBe('deepseek/deepseek-v4')
  })
  test('providerLabel takes the first segment', () => {
    expect(providerLabel(null)).toBe('—')
    expect(providerLabel('openrouter/x')).toBe('openrouter')
    expect(providerLabel('solo')).toBe('solo')
  })
})

describe('formatDuration', () => {
  test('null/zero/negative → em dash', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })
  test('ms / s / m s with whole-second rounding', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(119_600)).toBe('2m') // rounds to 120s, not "1m 60s"
  })
})

describe('date formatters return the raw input on bad data', () => {
  test('formatBucketLabel', () => {
    expect(formatBucketLabel('')).toBe('')
    expect(formatBucketLabel('not-a-date')).toBe('not-a-date')
  })
  test('formatLogDate', () => {
    expect(formatLogDate('garbage')).toBe('garbage')
  })
})

import { describe, expect, test } from 'bun:test'
import { logDownloadFilename, safeLogName, toggleLogSeverity } from './logViewer'

describe('DevOps log viewer policy', () => {
  test('keeps at least one severity enabled', () => {
    const onlyErrors = ['error'] as const

    expect(toggleLogSeverity([...onlyErrors], 'error', false)).toEqual(['error'])
    expect(toggleLogSeverity(['error', 'warning'], 'warning', false)).toEqual(['error'])
  })

  test('does not duplicate an enabled severity and can restore a disabled one', () => {
    expect(toggleLogSeverity(['error'], 'error', true)).toEqual(['error'])
    expect(toggleLogSeverity(['error'], 'warning', true)).toEqual(['error', 'warning'])
  })

  test('sanitizes names and creates a deterministic portable download filename', () => {
    expect(safeLogName(' account-token-service / rgc4n ')).toBe('account-token-service-rgc4n')
    expect(safeLogName('***')).toBe('logs')
    expect(safeLogName('../..')).toBe('logs')
    expect(logDownloadFilename('pod logs', new Date('2026-07-28T10:11:12.345Z'))).toBe(
      'pod-logs-2026-07-28T10-11-12Z.log',
    )
  })
})

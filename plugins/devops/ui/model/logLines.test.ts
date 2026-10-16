import { describe, expect, test } from 'bun:test'
import {
  ALL_LOG_SEVERITIES,
  detectLogSeverity,
  filterLogLines,
  isLogViewportNearBottom,
  parseLogLines,
  stripLogAnsi,
  tokenizeLogMessage,
} from './logLines'

describe('DevOps log lines', () => {
  test('separates runtime timestamps while preserving raw lines for filtering and copy', () => {
    const lines = parseLogLines(
      [
        '2026-07-24T10:20:30.123456Z INFO server started on :8080',
        '2026-07-24T10:20:31Z {"level":"error","message":"database unavailable"}',
      ].join('\n'),
    )

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      index: 1,
      timestamp: '2026-07-24T10:20:30.123456Z',
      timeLabel: '10:20:30.123',
      message: 'INFO server started on :8080',
      severity: 'info',
    })
    expect(lines[1]?.severity).toBe('error')
    expect(lines[1]?.raw).toContain('2026-07-24T10:20:31Z')
  })

  test('recognizes common structured and plain-text levels', () => {
    expect(detectLogSeverity('level=TRACE cache lookup')).toBe('debug')
    expect(detectLogSeverity('WARN retrying request')).toBe('warning')
    expect(detectLogSeverity('panic: runtime error')).toBe('error')
    expect(detectLogSeverity('ordinary access log')).toBe('plain')
    expect(detectLogSeverity('2026/07/24 10:20:30 [error] upstream closed')).toBe('error')
    expect(detectLogSeverity('ts=1 lvl=warn msg="slow"')).toBe('warning')
  })

  test('a level word inside the message prose is not a level', () => {
    expect(detectLogSeverity('build finished: 0 errors, 0 warnings')).toBe('plain')
    expect(detectLogSeverity('GET /health 200 - retry failed earlier')).toBe('plain')
    expect(detectLogSeverity('server started, ready to accept connections')).toBe('plain')
  })

  test('filters case-insensitively and leaves the source array untouched', () => {
    const lines = parseLogLines('INFO Ready\nERROR Failed\nrequest complete')
    expect(filterLogLines(lines, 'error')).toHaveLength(1)
    expect(filterLogLines(lines, '')).not.toBe(lines)
    expect(filterLogLines(lines, '', ['error', 'warning'])).toEqual([lines[1]])
    expect(filterLogLines(lines, '', ALL_LOG_SEVERITIES)).toHaveLength(3)
    expect(lines).toHaveLength(3)
  })

  test('uses a small bottom threshold for follow mode', () => {
    expect(isLogViewportNearBottom(1000, 470, 500)).toBe(true)
    expect(isLogViewportNearBottom(1000, 400, 500)).toBe(false)
  })

  test('keeps raw copy text while stripping ANSI and tokenizing console output', () => {
    const raw = '\u001b[31mERROR\u001b[0m GET /health 503'
    const [line] = parseLogLines(raw)

    expect(line?.raw).toBe(raw)
    expect(line?.display).toBe('ERROR GET /health 503')
    expect(stripLogAnsi(raw)).toBe('ERROR GET /health 503')
    expect(line?.tokens.map(({ text, kind }) => [text, kind])).toEqual([
      ['ERROR', 'error'],
      [' ', 'plain'],
      ['GET', 'method'],
      [' /health ', 'plain'],
      ['503', 'status-error'],
    ])
  })

  test('colors structured JSON keys and scalar values without reformatting it', () => {
    const input = '{"level":"info","ready":true,"count":3,"error":null}'
    const tokens = tokenizeLogMessage(input)

    expect(tokens.map((part) => part.text).join('')).toBe(input)
    expect(tokens.some((part) => part.text === '"level"' && part.kind === 'key')).toBe(true)
    expect(tokens.some((part) => part.text === '"info"' && part.kind === 'string')).toBe(true)
    expect(tokens.some((part) => part.text === 'true' && part.kind === 'boolean')).toBe(true)
    expect(tokens.some((part) => part.text === '3' && part.kind === 'number')).toBe(true)
    expect(tokens.some((part) => part.text === 'null' && part.kind === 'null')).toBe(true)
  })
})

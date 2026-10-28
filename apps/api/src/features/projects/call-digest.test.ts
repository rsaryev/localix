import { describe, expect, test } from 'bun:test'

import {
  buildCallDigest,
  callInputSummary,
  callResultExcerpt,
  CALL_RESULT_HEAD_CHARS,
  CALL_RESULT_TAIL_CHARS,
  type CallDigestInput,
} from './call-digest'

const base: CallDigestInput = {
  sessionId: 'LOCALIX-7',
  toolCallId: 'toolu_01ABC',
  name: 'Bash',
  status: 'completed',
  itemType: 'command',
}

describe('callInputSummary', () => {
  test('prefers the shell command for command items', () => {
    expect(callInputSummary({ ...base, command: 'bun test', input: { ignored: true } })).toBe(
      'bun test',
    )
  })

  test('joins changed paths for file_change items', () => {
    expect(
      callInputSummary({ ...base, itemType: 'file_change', changedPaths: ['a.ts', 'b.ts'] }),
    ).toBe('a.ts, b.ts')
  })

  test('falls back to JSON input; empty input yields null', () => {
    expect(callInputSummary({ ...base, input: { path: 'x.ts' } })).toBe('{"path":"x.ts"}')
    expect(callInputSummary({ ...base, input: {} })).toBeNull()
    expect(callInputSummary(base)).toBeNull()
  })
})

describe('callResultExcerpt', () => {
  test('short results pass through; long results keep head + tail', () => {
    expect(callResultExcerpt('all good')).toBe('all good')
    const long =
      'H'.repeat(CALL_RESULT_HEAD_CHARS) + 'M'.repeat(500) + 'T'.repeat(CALL_RESULT_TAIL_CHARS)
    const excerpt = callResultExcerpt(long)
    expect(excerpt).toContain('[…middle elided…]')
    expect(excerpt.startsWith('H')).toBe(true)
    expect(excerpt.endsWith('T')).toBe(true)
  })
})

describe('buildCallDigest', () => {
  test('renders name, status, input, result, and the history pointer', () => {
    const digest = buildCallDigest({ ...base, command: 'bun test', resultText: '12 pass, 0 fail' })
    expect(digest).toContain('Tool call toolu_01ABC — `Bash` (completed) in session LOCALIX-7')
    expect(digest).toContain('Input: bun test')
    expect(digest).toContain('12 pass, 0 fail')
    expect(digest).toContain('history')
  })

  test('failed calls surface the error line and a FAILED marker', () => {
    const digest = buildCallDigest({
      ...base,
      status: 'failed',
      errorText: 'command exited 1: boom',
    })
    expect(digest).toContain('(FAILED)')
    expect(digest).toContain('Error: command exited 1: boom')
  })
})

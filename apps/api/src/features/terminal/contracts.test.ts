import { describe, expect, test } from 'bun:test'
import {
  MAX_TERMINAL_INPUT_BYTES,
  parseTerminalClientFrame,
  spawnTerminalRequestSchema,
  terminalClientFrameSchema,
} from './contracts'

describe('terminal client frames', () => {
  test('accepts bounded input and terminal dimensions', () => {
    expect(terminalClientFrameSchema.safeParse({ t: 'input', data: 'ls\r' }).success).toBe(true)
    expect(terminalClientFrameSchema.safeParse({ t: 'resize', cols: 120, rows: 40 }).success).toBe(
      true,
    )
  })

  test('rejects malformed frames before they reach the PTY backend', () => {
    for (const frame of [
      { t: 'input', data: 7 },
      { t: 'input', data: 'x'.repeat(MAX_TERMINAL_INPUT_BYTES + 1) },
      { t: 'input', data: 'x', extra: true },
      { t: 'resize', cols: Number.NaN, rows: 24 },
      { t: 'resize', cols: 0, rows: 24 },
      { t: 'resize', cols: 80.5, rows: 24 },
      { t: 'resize', cols: 80, rows: 24, extra: true },
      { t: 'resize', cols: 80, rows: 1001 },
      { t: 'unknown', data: 'x' },
    ]) {
      expect(terminalClientFrameSchema.safeParse(frame).success).toBe(false)
    }
  })

  test('enforces byte limits for Unicode and rejects oversized frames before decoding', () => {
    const unicode = '😀'.repeat(MAX_TERMINAL_INPUT_BYTES / 4 + 1)
    expect(unicode.length).toBeLessThan(MAX_TERMINAL_INPUT_BYTES)
    expect(terminalClientFrameSchema.safeParse({ t: 'input', data: unicode }).success).toBe(false)
    expect(parseTerminalClientFrame(JSON.stringify({ t: 'input', data: unicode }))).toBeNull()

    const command = 'α'.repeat(MAX_TERMINAL_INPUT_BYTES / 2 + 1)
    expect(spawnTerminalRequestSchema.safeParse({ command }).success).toBe(false)
  })

  test('the WebSocket decoder fails closed without producing a PTY action', () => {
    for (const payload of [
      null,
      new Uint8Array([1]),
      '{',
      JSON.stringify({ t: 'resize', cols: 0, rows: 24 }),
      JSON.stringify({ t: 'input', data: 'x', extra: true }),
      JSON.stringify({ t: 'bogus', data: 'x' }),
    ]) {
      expect(parseTerminalClientFrame(payload)).toBeNull()
    }
    expect(parseTerminalClientFrame(JSON.stringify({ t: 'input', data: 'ok' }))).toEqual({
      t: 'input',
      data: 'ok',
    })
  })
})

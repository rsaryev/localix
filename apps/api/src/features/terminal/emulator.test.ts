import { describe, expect, test } from 'bun:test'
import { createEmulator } from './emulator'

const ALT_ENTER = '\x1b[?1049h'
const CLEAR = '\x1b[2J\x1b[H'
/** Cursor Position: CSI row;col H (1-indexed). */
const cup = (row: number, col: number) => `\x1b[${row};${col}H`

describe('createEmulator', () => {
  // Regression: @xterm/headless parses write() on a later tick, so a snapshot taken
  // synchronously right after feeding bytes used to read a BLANK grid — a full-screen
  // TUI rendered as an empty screen. screen() must drain the parser first.
  test('screen() reflects bytes fed immediately before it (no async-parse race)', async () => {
    const em = createEmulator(80, 24)
    em.write('hello world')
    const s = await em.screen()
    expect(s.text).toBe('hello world')
    expect(s.cursor).toEqual({ row: 0, col: 11 })
    em.dispose()
  })

  test('dispose waits for an in-flight screen drain instead of racing xterm parsing', async () => {
    const em = createEmulator(80, 24)
    em.write('final frame')
    const snapshot = em.screen()
    // A real one-shot PTY can exit in this exact window. xterm must remain alive
    // until the queued parser drain has produced the final snapshot.
    em.dispose()
    expect((await snapshot).text).toBe('final frame')
  })

  test('renders a full-screen TUI on the alternate buffer', async () => {
    const em = createEmulator(80, 24)
    em.write(ALT_ENTER + CLEAR)
    for (let r = 1; r <= 24; r++) em.write(`${cup(r, 1)}Row ${r}`)
    const s = await em.screen()
    const lines = s.text.split('\n')
    expect(lines).toHaveLength(24)
    expect(lines[0]).toBe('Row 1')
    expect(lines[23]).toBe('Row 24')
    expect(s.cols).toBe(80)
    expect(s.rows).toBe(24)
    em.dispose()
  })

  test('trims trailing blank rows but keeps blank rows between content', async () => {
    const em = createEmulator(20, 6)
    em.write(ALT_ENTER + CLEAR)
    em.write(`${cup(1, 1)}TITLE`)
    em.write(`${cup(6, 1)}footer`)
    const s = await em.screen()
    // rows 2-5 are blank and must be preserved (they sit between content).
    expect(s.text.split('\n')).toEqual(['TITLE', '', '', '', '', 'footer'])
    em.dispose()
  })

  test('resize while on the alternate screen keeps the reported dimensions', async () => {
    const em = createEmulator(80, 24)
    em.write(ALT_ENTER + CLEAR)
    em.write(`${cup(1, 1)}content`)
    em.resize(100, 30)
    const s = await em.screen()
    expect(s.cols).toBe(100)
    expect(s.rows).toBe(30)
    em.dispose()
  })

  test('clamps transiently tiny viewer dimensions to xterm-safe bounds', async () => {
    const em = createEmulator(0, 1)
    expect(await em.screen()).toMatchObject({ cols: 2, rows: 2 })
    em.resize(1, 0)
    expect(await em.screen()).toMatchObject({ cols: 2, rows: 2 })
    em.dispose()
  })
})

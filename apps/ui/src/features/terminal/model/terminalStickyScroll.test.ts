import { describe, it, expect } from 'bun:test'
import { computeStickyCommand, type StickyCommand } from './terminalStickyScroll'

const cmd = (
  promptLine: number,
  endLine: number | null,
  text = `cmd@${promptLine}`,
): StickyCommand => ({ promptLine, endLine, text })

describe('computeStickyCommand', () => {
  it('pins nothing with no commands', () => {
    expect(computeStickyCommand(10, [])).toBeNull()
  })

  it('pins nothing when the prompt is still visible (top at/above prompt)', () => {
    const c = cmd(5, 20)
    expect(computeStickyCommand(5, [c])).toBeNull() // top == promptLine → prompt on screen
    expect(computeStickyCommand(3, [c])).toBeNull() // scrolled above the command
  })

  it('pins the command whose output region contains the top', () => {
    const c = cmd(5, 20)
    expect(computeStickyCommand(10, [c])).toBe(c)
    expect(computeStickyCommand(19, [c])).toBe(c)
  })

  it('does not pin once scrolled past the command end', () => {
    const c = cmd(5, 20)
    expect(computeStickyCommand(20, [c])).toBeNull() // top == endLine → past its output
    expect(computeStickyCommand(25, [c])).toBeNull()
  })

  it('pins a running command (null endLine) for any top below its prompt', () => {
    const c = cmd(5, null)
    expect(computeStickyCommand(6, [c])).toBe(c)
    expect(computeStickyCommand(9999, [c])).toBe(c)
  })

  it('picks the innermost (largest promptLine) among overlapping regions', () => {
    const a = cmd(2, 100)
    const b = cmd(40, 100)
    expect(computeStickyCommand(50, [a, b])).toBe(b)
  })

  it('selects the right command among sequential ones', () => {
    const a = cmd(2, 10)
    const b = cmd(12, 30)
    const c = cmd(32, null)
    expect(computeStickyCommand(5, [a, b, c])).toBe(a)
    expect(computeStickyCommand(20, [a, b, c])).toBe(b)
    expect(computeStickyCommand(50, [a, b, c])).toBe(c)
    expect(computeStickyCommand(11, [a, b, c])).toBeNull() // idle gap between a.end and b.prompt
  })

  it('does not pin a command with empty text', () => {
    expect(computeStickyCommand(10, [cmd(5, 20, '')])).toBeNull()
  })
})

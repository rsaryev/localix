import { describe, expect, it } from 'bun:test'
import { parseOsc133, exitDotColor } from './shellIntegration'

describe('parseOsc133', () => {
  it('parses prompt/command boundary marks', () => {
    expect(parseOsc133('A')).toEqual({ type: 'A' })
    expect(parseOsc133('B')).toEqual({ type: 'B' })
    expect(parseOsc133('C')).toEqual({ type: 'C' })
  })

  it('parses command completion with an exit code', () => {
    expect(parseOsc133('D;0')).toEqual({ type: 'D', exitCode: 0 })
    expect(parseOsc133('D;1')).toEqual({ type: 'D', exitCode: 1 })
    expect(parseOsc133('D;130')).toEqual({ type: 'D', exitCode: 130 })
  })

  it('treats a bare or non-numeric D as an unknown exit code', () => {
    expect(parseOsc133('D')).toEqual({ type: 'D', exitCode: null })
    expect(parseOsc133('D;')).toEqual({ type: 'D', exitCode: null })
    expect(parseOsc133('D;abc')).toEqual({ type: 'D', exitCode: null })
  })

  it('tolerates extra semicolon-separated params (e.g. vscode aid=)', () => {
    expect(parseOsc133('D;0;aid=123')).toEqual({ type: 'D', exitCode: 0 })
    expect(parseOsc133('A;foo=bar')).toEqual({ type: 'A' })
  })

  it('returns null for unrecognized marks', () => {
    expect(parseOsc133('P;Cwd=/x')).toBeNull()
    expect(parseOsc133('')).toBeNull()
    expect(parseOsc133('Z')).toBeNull()
  })
})

describe('exitDotColor', () => {
  it('is green for success, red for failure, grey for unknown', () => {
    expect(exitDotColor(0)).toBe('#3fb950')
    expect(exitDotColor(1)).toBe('#f85149')
    expect(exitDotColor(130)).toBe('#f85149')
    expect(exitDotColor(null)).toBe('#8b949e')
  })

  it('uses the light-palette hues when isLight is set', () => {
    expect(exitDotColor(0, true)).toBe('#28a745')
    expect(exitDotColor(1, true)).toBe('#d73a49')
    expect(exitDotColor(null, true)).toBe('#6a737d')
  })

  it('always returns a solid #RRGGBB (xterm requires hex)', () => {
    for (const c of [0, 1, 255, null]) {
      expect(exitDotColor(c)).toMatch(/^#[0-9a-f]{6}$/)
      expect(exitDotColor(c, true)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

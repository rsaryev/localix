import { describe, expect, it } from 'bun:test'
import { detectIndentation } from './detectIndentation'

describe('detectIndentation', () => {
  it('defaults to 2 spaces on empty input', () => {
    expect(detectIndentation('')).toEqual({ usesTabs: false, size: 2 })
  })

  it('detects tab indentation', () => {
    const code = 'function f() {\n\treturn 1;\n\tif (x) {\n\t\ty();\n\t}\n}'
    expect(detectIndentation(code)).toEqual({ usesTabs: true, size: 4 })
  })

  it('detects 2-space indentation', () => {
    const code = 'const a = {\n  x: 1,\n  y: {\n    z: 2,\n  },\n};'
    expect(detectIndentation(code)).toEqual({ usesTabs: false, size: 2 })
  })

  it('detects 4-space indentation', () => {
    const code = 'def f():\n    x = 1\n    if x:\n        return x\n    return 0'
    expect(detectIndentation(code)).toEqual({ usesTabs: false, size: 4 })
  })

  it('ignores blank / whitespace-only lines', () => {
    const code = 'a\n  b\n   \n  c\n'
    expect(detectIndentation(code)).toEqual({ usesTabs: false, size: 2 })
  })

  it('falls back to default when there is no indentation', () => {
    expect(detectIndentation('a\nb\nc')).toEqual({ usesTabs: false, size: 2 })
  })
})

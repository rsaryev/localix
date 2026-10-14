import { describe, expect, it } from 'bun:test'
import { convertIndentation } from './convertIndentation'

describe('convertIndentation', () => {
  it('expands leading tabs to spaces', () => {
    const input = '\tif (x) {\n\t\treturn;\n\t}'
    expect(convertIndentation(input, 2, 'spaces')).toBe('  if (x) {\n    return;\n  }')
    expect(convertIndentation(input, 4, 'spaces')).toBe('    if (x) {\n        return;\n    }')
  })

  it('collapses leading space runs to tabs', () => {
    const input = '  if (x) {\n    return;\n  }'
    expect(convertIndentation(input, 2, 'tabs')).toBe('\tif (x) {\n\t\treturn;\n\t}')
  })

  it('only touches leading whitespace, not spaces inside the line', () => {
    const input = '  const a = b + c;'
    expect(convertIndentation(input, 2, 'tabs')).toBe('\tconst a = b + c;')
    // Inner spacing is preserved.
    expect(convertIndentation('    a  =  1', 4, 'tabs')).toBe('\ta  =  1')
  })

  it('preserves leftover spaces shorter than a tab', () => {
    // 6 spaces at width 4 → one tab + two leftover spaces.
    expect(convertIndentation('      x', 4, 'tabs')).toBe('\t  x')
  })

  it('leaves non-indented and empty lines unchanged', () => {
    expect(convertIndentation('no indent\n\nalso none', 4, 'spaces')).toBe('no indent\n\nalso none')
  })

  it('handles mixed tab/space prefixes when converting to spaces', () => {
    expect(convertIndentation('\t  x', 4, 'spaces')).toBe('      x')
  })

  it('clamps a zero/negative width to 1', () => {
    expect(convertIndentation('\tx', 0, 'spaces')).toBe(' x')
  })

  it('is idempotent when already in the target unit', () => {
    const spaces = '  a\n    b'
    expect(convertIndentation(spaces, 2, 'spaces')).toBe(spaces)
  })
})

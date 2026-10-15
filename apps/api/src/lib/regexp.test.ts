import { describe, expect, test } from 'bun:test'
import { escapeRegExp } from './regexp'

describe('escapeRegExp', () => {
  test('matches every syntax character literally', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o'
    const re = new RegExp(`^${escapeRegExp(raw)}$`, 'u')
    expect(re.test(raw)).toBe(true)
    expect(re.test(raw.replace('.', 'X'))).toBe(false)
  })

  test('leaves plain text untouched', () => {
    expect(escapeRegExp('react-dom/client')).toBe('react-dom/client')
  })
})

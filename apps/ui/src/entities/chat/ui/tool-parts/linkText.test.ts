import { describe, expect, it } from 'bun:test'
import { splitLinkedPaths } from './linkText'

describe('splitLinkedPaths', () => {
  it('links a grep-style path:line, strips the suffix, and captures the line', () => {
    const segs = splitLinkedPaths('src/features/foo.ts:42:  const x = 1')
    expect(segs[0]).toEqual({
      text: 'src/features/foo.ts:42',
      start: 0,
      path: 'src/features/foo.ts',
      line: 42,
    })
    expect(segs[1]).toEqual({ text: ':  const x = 1', start: 22 })
  })

  it('links an absolute path with line:col, capturing the line (not the col)', () => {
    const segs = splitLinkedPaths('at /Users/me/app/index.ts:10:5 (foo)')
    const link = segs.find((s) => s.path)
    expect(link).toEqual({
      text: '/Users/me/app/index.ts:10:5',
      start: 3,
      path: '/Users/me/app/index.ts',
      line: 10,
    })
  })

  it('a path without a line carries no line field', () => {
    const segs = splitLinkedPaths('see src/a/b.tsx for details')
    expect(segs.find((s) => s.path)).toMatchObject({ path: 'src/a/b.tsx' })
    expect(segs.find((s) => s.path)?.line).toBeUndefined()
  })

  it('does not link prose without a slash', () => {
    const segs = splitLinkedPaths('e.g. version v1.2 is fine')
    expect(segs.every((s) => !s.path)).toBe(true)
    expect(segs.map((s) => s.text).join('')).toBe('e.g. version v1.2 is fine')
  })

  it('round-trips the original text', () => {
    const input = 'see apps/ui/src/a.tsx and packages/agent/b.ts:3 for details'
    expect(
      splitLinkedPaths(input)
        .map((s) => s.text)
        .join(''),
    ).toBe(input)
  })

  it('links an http(s) URL and strips trailing punctuation', () => {
    const segs = splitLinkedPaths('see https://example.com/path?q=1.')
    const link = segs.find((s) => s.href)
    expect(link).toEqual({
      text: 'https://example.com/path?q=1',
      start: 4,
      href: 'https://example.com/path?q=1',
    })
    // the stripped '.' is preserved as plain text → full round-trip
    expect(segs.map((s) => s.text).join('')).toBe('see https://example.com/path?q=1.')
  })

  it('treats a URL as a link, not a path, even with a file-like tail', () => {
    const segs = splitLinkedPaths('https://host.dev/src/app.ts')
    expect(segs).toHaveLength(1)
    expect(segs[0].href).toBe('https://host.dev/src/app.ts')
    expect(segs[0].path).toBeUndefined()
  })
})

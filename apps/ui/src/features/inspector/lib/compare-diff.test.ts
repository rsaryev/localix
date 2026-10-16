import { describe, expect, test } from 'bun:test'
import { buildCompareDiff, compareDiffPath } from './compare-diff'

describe('buildCompareDiff', () => {
  test('emits a unified diff with per-side basename headers', () => {
    const d = buildCompareDiff('/repo/a.ts', '/repo/sub/b.ts', 'const x = 1\n', 'const x = 2\n')
    expect(d).toContain('--- a.ts')
    expect(d).toContain('+++ b.ts')
    expect(d).toContain('-const x = 1')
    expect(d).toContain('+const x = 2')
  })

  test('identical content produces no hunks', () => {
    const d = buildCompareDiff('/a', '/b', 'same\n', 'same\n')
    expect(d).not.toContain('@@')
  })

  test('files differing only by a trailing newline are treated as identical', () => {
    const d = buildCompareDiff('/a', '/b', 'line', 'line\n')
    expect(d).not.toContain('@@')
    expect(d).not.toContain('No newline')
  })
})

describe('compareDiffPath', () => {
  test('is stable and distinct from either real path', () => {
    const id = compareDiffPath('/repo/a.ts', '/repo/b.ts')
    expect(id).toBe('compare:///repo/a.ts↔/repo/b.ts')
    expect(id).not.toBe('/repo/a.ts')
    expect(id).not.toBe('/repo/b.ts')
  })

  // Compare-with-Clipboard reuses this plumbing with a synthetic left path whose
  // basename ("Clipboard") becomes the diff's original header.
  test('renders "Clipboard" as the original header for a synthetic clipboard path', () => {
    const d = buildCompareDiff('clipboard://Clipboard', '/repo/b.ts', 'from clip\n', 'on disk\n')
    expect(d).toContain('--- Clipboard')
    expect(d).toContain('+++ b.ts')
    expect(d).toContain('-from clip')
    expect(d).toContain('+on disk')
  })
})

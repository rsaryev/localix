import { describe, expect, it } from 'bun:test'
import { computeStickyChain, type StickySymbol } from './stickyScroll'

const sym = (name: string, line: number, endLine: number, depth: number): StickySymbol => ({
  name,
  line,
  endLine,
  depth,
})

describe('computeStickyChain', () => {
  it('returns empty when the top line is inside no scope', () => {
    const symbols = [sym('foo', 10, 20, 0)]
    expect(computeStickyChain(symbols, 5)).toEqual([])
  })

  it('pins a scope whose header scrolled above the top line', () => {
    const symbols = [sym('foo', 10, 20, 0)]
    expect(computeStickyChain(symbols, 15).map((s) => s.name)).toEqual(['foo'])
  })

  it('does NOT pin a scope whose header is itself the top visible line', () => {
    // Pinning it would duplicate the visible header and cover the code under it.
    const symbols = [sym('foo', 10, 20, 0)]
    expect(computeStickyChain(symbols, 10)).toEqual([])
  })

  it('excludes a scope once the top line passes its end', () => {
    const symbols = [sym('foo', 10, 20, 0)]
    expect(computeStickyChain(symbols, 20)).toEqual([])
  })

  it('orders nested scopes outermost → innermost', () => {
    const symbols = [sym('Cls', 5, 40, 0), sym('method', 8, 30, 1), sym('inner', 12, 20, 2)]
    expect(computeStickyChain(symbols, 15).map((s) => s.name)).toEqual(['Cls', 'method', 'inner'])
  })

  it('caps at 5, dropping the outermost scopes first', () => {
    const symbols = Array.from({ length: 7 }, (_, i) => sym(`s${i}`, i, 100 - i, i))
    const chain = computeStickyChain(symbols, 50)
    expect(chain.map((s) => s.name)).toEqual(['s2', 's3', 's4', 's5', 's6'])
  })

  it('ignores zero-height symbols (header == end)', () => {
    expect(computeStickyChain([sym('x', 10, 10, 0)], 10)).toEqual([])
  })
})

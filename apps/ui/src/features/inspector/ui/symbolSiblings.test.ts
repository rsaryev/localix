import { describe, expect, it } from 'bun:test'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { symbolSiblings } from './symbolSiblings'

function sym(name: string, depth: number, line: number, endLine: number): LspDocumentSymbol {
  return { name, kind: 12, line, character: 0, endLine, depth }
}

// Outline:
//   ClassA        (depth 0, 0–30)
//     methodA1    (depth 1, 2–10)
//     methodA2    (depth 1, 12–28)
//   ClassB        (depth 0, 32–40)
//     methodB1    (depth 1, 34–38)
const doc: LspDocumentSymbol[] = [
  sym('ClassA', 0, 0, 30),
  sym('methodA1', 1, 2, 10),
  sym('methodA2', 1, 12, 28),
  sym('ClassB', 0, 32, 40),
  sym('methodB1', 1, 34, 38),
]

describe('symbolSiblings', () => {
  it('returns all top-level symbols for a depth-0 crumb', () => {
    const path = [doc[0]] // ClassA
    expect(symbolSiblings(doc, path, 0).map((s) => s.name)).toEqual(['ClassA', 'ClassB'])
  })

  it('scopes deeper siblings to the parent span, not every same-depth symbol', () => {
    const path = [doc[0], doc[2]] // ClassA → methodA2
    // Must exclude methodB1 (same depth, but inside ClassB).
    expect(symbolSiblings(doc, path, 1).map((s) => s.name)).toEqual(['methodA1', 'methodA2'])
  })

  it('returns document order regardless of crumb position', () => {
    const path = [doc[3], doc[4]] // ClassB → methodB1
    expect(symbolSiblings(doc, path, 1).map((s) => s.name)).toEqual(['methodB1'])
  })

  it('is empty for an out-of-range index', () => {
    expect(symbolSiblings(doc, [doc[0]], 5)).toEqual([])
  })

  it('is empty when there are no document symbols', () => {
    expect(symbolSiblings([], [doc[0]], 0)).toEqual([])
  })
})

import { describe, expect, test } from 'bun:test'

import { reactFiberResolver, dataAttrResolver } from './index'

/** Minimal element-like object carrying a React fiber under a hashed key. */
function elWithFiber(fiber: unknown): Element {
  return { ['__reactFiber$abc']: fiber } as unknown as Element
}

/** Minimal element-like exposing only getAttribute. */
function attrEl(attrs: Record<string, string>): Element {
  return { getAttribute: (k: string) => attrs[k] ?? null } as unknown as Element
}

describe('dataAttrResolver', () => {
  const r = dataAttrResolver()
  test('parses data-source-loc "file:line:col"', () => {
    expect(r.resolve(attrEl({ 'data-source-loc': 'src/App.tsx:42:5' }))).toEqual({
      file: 'src/App.tsx',
      line: 42,
      column: 5,
      method: 'data-attr',
      confidence: 'high',
    })
  })
  test('reads react-dev-inspector path/line/column triple', () => {
    const got = r.resolve(
      attrEl({
        'data-inspector-relative-path': 'src/Btn.tsx',
        'data-inspector-line': '7',
        'data-inspector-column': '3',
      }),
    )
    expect(got).toEqual({
      file: 'src/Btn.tsx',
      line: 7,
      column: 3,
      method: 'data-attr',
      confidence: 'high',
    })
  })
  test('reads data-source-file/-line; data-od-id is component-only; null otherwise', () => {
    expect(r.resolve(attrEl({ 'data-source-file': 'a.tsx', 'data-source-line': '9' }))).toEqual({
      file: 'a.tsx',
      line: 9,
      method: 'data-attr',
      confidence: 'high',
    })
    expect(r.resolve(attrEl({ 'data-od-id': 'Hero' }))).toEqual({
      component: 'Hero',
      method: 'data-attr',
      confidence: 'medium',
    })
    expect(r.resolve(attrEl({}))).toBeNull()
  })
})

describe('reactFiberResolver', () => {
  test('reads `_debugSource` (React ≤18 automatic runtime)', () => {
    const el = elWithFiber({
      _debugSource: { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 4 },
      type: { name: 'App' },
    })
    expect(reactFiberResolver().resolve(el)).toEqual({
      file: 'src/App.tsx',
      line: 12,
      column: 4,
      component: 'App',
      method: 'react-fiber',
      confidence: 'high',
    })
  })

  test('reads the `__source` prop (classic runtime / React 19, no `_debugSource`)', () => {
    const el = elWithFiber({
      memoizedProps: { __source: { fileName: 'src/Button.tsx', lineNumber: 7 } },
      type: { name: 'Button' },
    })
    const got = reactFiberResolver().resolve(el)
    expect(got?.file).toBe('src/Button.tsx')
    expect(got?.line).toBe(7)
    expect(got?.component).toBe('Button')
  })

  test('walks up `return` to an ancestor that carries source', () => {
    const el = elWithFiber({
      return: {
        memoizedProps: { __source: { fileName: 'src/Card.tsx', lineNumber: 3 } },
        type: { name: 'Card' },
      },
    })
    expect(reactFiberResolver().resolve(el)?.file).toBe('src/Card.tsx')
  })

  test('returns null when no source is present anywhere', () => {
    expect(reactFiberResolver().resolve(elWithFiber({ type: { name: 'X' } }))).toBeNull()
    expect(reactFiberResolver().resolve({} as unknown as Element)).toBeNull()
  })
})

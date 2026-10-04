import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { SymbolBreadcrumbBar } from './SymbolBreadcrumbBar'

const sym = (name: string, line: number, endLine: number, depth = 0): LspDocumentSymbol => ({
  name,
  kind: 12, // Function
  line,
  character: 0,
  endLine,
  depth,
})

const noop = () => {}

describe('SymbolBreadcrumbBar', () => {
  test('keeps the file breadcrumb for files without language symbols', () => {
    const html = renderToStaticMarkup(
      <SymbolBreadcrumbBar fileName="notes.txt" symbolPath={[]} docSymbols={[]} onJump={noop} />,
    )
    expect(html).toContain('notes.txt')
    expect(html).toContain('aria-current="location"')
  })

  // Regression (editor jumps on click): when the file HAS an outline but the caret
  // sits outside every symbol (blank line, imports, top level), the bar used to
  // return null — mounting/unmounting a whole row above the editor on every click
  // that crossed a symbol boundary, shifting all the code under the pointer. The
  // bar row must stay rendered (with a height-preserving placeholder) instead.
  test('stays mounted with an empty symbol path when the file has symbols', () => {
    const html = renderToStaticMarkup(
      <SymbolBreadcrumbBar
        fileName="main.py"
        symbolPath={[]}
        docSymbols={[sym('foo', 4, 10)]}
        onJump={noop}
      />,
    )
    expect(html).not.toBe('')
    expect(html).toContain('<nav')
    expect(html).toContain('aria-label="Document symbols"')
    expect(html).toContain('border-b') // the bar container row
    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('Browse symbols in main.py')
  })

  test('renders the enclosing-symbol chain when the caret is inside symbols', () => {
    const html = renderToStaticMarkup(
      <SymbolBreadcrumbBar
        fileName="main.ts"
        symbolPath={[sym('Outer', 1, 30, 0), sym('inner', 4, 10, 1)]}
        docSymbols={[sym('Outer', 1, 30, 0), sym('inner', 4, 10, 1)]}
        onJump={noop}
      />,
    )
    expect(html).toContain('Outer')
    expect(html).toContain('inner')
    expect(html).toContain('<ol')
    expect(html).toContain('aria-current="location"')
    expect(html).toContain('focus-ring')
    expect(html).not.toContain('\u200B')
  })

  test('offers children even when the enclosing symbol has no siblings', () => {
    const outer = sym('Outer', 1, 30)
    const inner = sym('inner', 4, 10, 1)
    const html = renderToStaticMarkup(
      <SymbolBreadcrumbBar
        fileName="main.js"
        symbolPath={[outer]}
        docSymbols={[outer, inner]}
        onJump={noop}
      />,
    )
    expect(html).toContain('Browse children of Outer')
    expect(html).toContain('Go to Outer')
  })
})

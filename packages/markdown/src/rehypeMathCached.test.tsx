import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeMathCached, { typesetMath } from '@localixai/markdown/rehypeMathCached'

const toHtml = (markdown: string) =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeMathCached]}>
      {markdown}
    </ReactMarkdown>,
  )

describe('rehypeMathCached', () => {
  test('typesets inline and display math in place of remark-math nodes', () => {
    const html = toHtml('Inline $E = mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$')
    expect(html).toContain('<span class="katex">')
    expect(html).toContain('<span class="katex-display">')
    expect(html).not.toContain('language-math')
  })

  test('a formula it has set before is reused, not typeset again', () => {
    // Identity is the observable: a cache hit hands back the very nodes of the first render.
    const first = typesetMath('x^2 + y^2 = z^2', false)
    expect(typesetMath('x^2 + y^2 = z^2', false)).toBe(first)
    expect(typesetMath('x^2 + y^2 = z^2', true)).not.toBe(first)
  })

  test('an expression KaTeX cannot parse renders its own error form instead of throwing', () => {
    const html = toHtml('Broken $\\frac{a}{$ here.')
    expect(html).toContain('katex-error')
  })
})

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import { escapeLiteralDollars, isLiteralDollar } from './markdown-dollars'
import rehypeMathCached from './rehypeMathCached'

describe('isLiteralDollar', () => {
  test('currency amounts and shell variables are dollar signs', () => {
    for (const text of ['$5 and', '$10,', '$1.5M today', '$HOME/bin', '$PATH,', '$PATH before']) {
      expect(isLiteralDollar(text, 0)).toBe(true)
    }
  })

  test('formulas, display math and escaped dollars are not', () => {
    for (const text of ['$E = mc^2$', '$10^6$', '$2x$', '$AB$', '$AB = CD$', '$$', '$x_i$']) {
      expect(isLiteralDollar(text, 0)).toBe(false)
    }
    expect(isLiteralDollar('\\$5', 1)).toBe(false)
  })
})

describe('escapeLiteralDollars', () => {
  test('escapes literal dollars in prose, including at the very start', () => {
    expect(escapeLiteralDollars('$5 and $10')).toBe('\\$5 and \\$10')
    expect(escapeLiteralDollars('Formula $x$ costs $5')).toBe('Formula $x$ costs \\$5')
  })

  test('leaves code untouched and returns the same string when nothing changes', () => {
    const code = 'Run `echo $HOME` and\n```sh\nexport $PATH\n```'
    expect(escapeLiteralDollars(code)).toBe(code)
    const plain = 'No dollars here'
    expect(escapeLiteralDollars(plain)).toBe(plain)
  })

  test('a reply with one real formula no longer typesets its prices and variables', () => {
    // The shape of the reported reply: remark-math paired `$5 and $` into a formula and turned
    // `$HOME/bin and $PATH` into italic math that swallowed the code span after it.
    const reply =
      'Formula $a*b$, price $5 and $10, variables $HOME/bin and $PATH, command `echo $USER`.'
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeMathCached]}>
        {escapeLiteralDollars(reply)}
      </ReactMarkdown>,
    )
    expect(html.match(/class="katex"/g)).toHaveLength(1)
    expect(html).toContain('price $5 and $10, variables $HOME/bin and $PATH, command')
    expect(html).toContain('<code>echo $USER</code>')
  })
})

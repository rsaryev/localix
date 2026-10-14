import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './react'
import { extractMarkdownHeadings } from './headings'
import rehypeMathCached from './rehypeMathCached'
import remarkMath from 'remark-math'
import ReactMarkdown from 'react-markdown'
import { escapeLiteralDollars } from './markdown-dollars'

const render = (source: string) => renderToStaticMarkup(<Markdown headingIds>{source}</Markdown>)

describe('portable Markdown', () => {
  test('renders the answer dialect beside sanitized HTML without application state', () => {
    const html = render(
      [
        '> [!TIP] One grammar',
        '> Used in both hosts.',
        '',
        '> [!STEPS]',
        '> 1. **Read** — Review the source.',
        '',
        '<div onclick="alert(1)">Safe text<script>alert(1)</script></div>',
        '',
        '[Unsafe](javascript:alert%281%29)',
      ].join('\n'),
    )
    expect(html).toContain('role="note"')
    expect(html).toContain('aria-label="One grammar"')
    expect(html).toContain('lx-steps')
    expect(html).toContain('Safe text')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })

  test('retains CommonMark soft line breaks and renders a tree outside pre/code', () => {
    const html = render('first line\nsecond line\n\n```tree\nsrc/\n└── main.ts\n```')
    expect(html).toContain('first line\nsecond line')
    expect(html).not.toContain('<br')
    expect(html).toContain('role="tree"')
    expect(html).toContain('main.ts')
    expect(html).not.toContain('<pre><div')
    expect(html).not.toContain('└──')
  })

  test('outline and rendered anchors agree for duplicates, setext and numbered headings', () => {
    const source =
      '# Page\n\n## Same\n\n## Same\n\n## Same-1\n\nSetext\n---\n\n## 1.2 Detail\n\n~~~md\n## Hidden\n~~~'
    const headings = extractMarkdownHeadings(source)
    expect(headings.map(({ id }) => id)).toEqual([
      'page',
      'same',
      'same-1',
      'same-1-1',
      'setext',
      '1-2-detail',
    ])
    const html = render(source)
    for (const { id } of headings) expect(html).toContain(`id="${id}"`)
    expect(html).not.toContain('id="hidden"')
    expect(html).toContain('lx-section-number')
  })

  test('keeps document anchors while raw HTML ids retain the sanitizer prefix', () => {
    const html = render('## Normal\n\n<div id="location">Safe</div>\n\n## Normal')
    expect(html).toContain('id="normal"')
    expect(html).toContain('id="normal-1"')
    expect(html).toContain('id="user-content-location"')
    expect(html).not.toContain('id="location"')
  })

  test('supports Unicode heading links and ignores headings inside code spans', () => {
    expect(extractMarkdownHeadings('## Пример\n\n## **Code** `value`\n\n    ## hidden')).toEqual([
      { depth: 2, text: 'Пример', id: 'пример' },
      { depth: 2, text: 'Code value', id: 'code-value' },
    ])
  })

  test('preserves currency, environment variables and fenced source beside real math', () => {
    const source = '$5 and $10; $HOME/bin. Formula: $x^2$.\n\n```bash\necho "$HOME"\n```'
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeMathCached]}>
        {escapeLiteralDollars(source)}
      </ReactMarkdown>,
    )
    expect(html.match(/class="katex"/g)).toHaveLength(1)
    expect(html).toContain('$5 and $10; $HOME/bin.')
    expect(html).toContain('echo &quot;$HOME&quot;')
  })
})

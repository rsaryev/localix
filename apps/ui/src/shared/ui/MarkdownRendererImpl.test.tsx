import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import MarkdownRendererImpl from './MarkdownRendererImpl'
import {
  boundPlainStreamingText,
  markdownComponentsForStreaming,
  shouldDeferOversizedMarkdown,
  shouldRenderPlainStreaming,
  shouldSmoothStreaming,
  shouldActivateHtml,
  shouldActivateMath,
  hasMathSyntax,
  hasHtmlSyntax,
  tableRequiresKeyboardScroll,
  STREAMING_PLAIN_TEXT_THRESHOLD,
} from './MarkdownRendererImpl'
import { rehypePluginsFor, remarkPluginsFor } from '@localixai/markdown/markdownPlugins'
import { classifyMarkdownLink, markdownUrlTransform } from './markdownLink'

describe('streaming markdown', () => {
  test('keeps sandbox artifact links clickable without weakening URL sanitization', () => {
    const fileName =
      '\u041f\u043b\u0430\u043d_\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a_' +
      '\u0434\u043b\u044f_\u043f\u043e\u0445\u0443\u0434\u0435\u043d\u0438\u044f.pdf'
    const href = `sandbox:/Users/me/.localix/workspace/LOCALIX-7/${fileName}`
    const label =
      '\u0421\u043a\u0430\u0447\u0430\u0442\u044c PDF-\u043f\u043b\u0430\u043d ' +
      '\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a'
    expect(markdownUrlTransform(href, 'href')).toBe(href)
    expect(markdownUrlTransform(href, 'src')).toBeUndefined()
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBeUndefined()

    const html = renderToStaticMarkup(
      <WorkItemSessionProvider sessionId="s1">
        <MarkdownRendererImpl>{`[${label}](${href})`}</MarkdownRendererImpl>
      </WorkItemSessionProvider>,
    )
    expect(html).not.toContain('href=""')
    expect(html).toContain('href="sandbox:/Users/me/.localix/workspace/LOCALIX-7/')
    expect(html).toContain('title="Open /Users/me/.localix/workspace/LOCALIX-7/')
  })

  test('does not create one animated DOM element per word', () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `word-${index}`).join(' ')
    const html = renderToStaticMarkup(
      <ReactMarkdown components={markdownComponentsForStreaming()}>{text}</ReactMarkdown>,
    )

    expect(html).not.toContain('stream-word')
    expect(html.match(/<span/g)).toBeNull()
  })

  test('highlights code both while streaming and after the stream settles', () => {
    const markdown = '```ts\nconst answer = 42\n```'
    const streaming = renderToStaticMarkup(
      <ReactMarkdown components={markdownComponentsForStreaming(true)}>{markdown}</ReactMarkdown>,
    )
    const settled = renderToStaticMarkup(
      <ReactMarkdown components={markdownComponentsForStreaming()}>{markdown}</ReactMarkdown>,
    )

    expect(streaming).toContain('sh__token--keyword')
    expect(settled).toContain('sh__token')
  })

  test('highlights an unfinished streaming fence without interpreting source as HTML', () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown components={markdownComponentsForStreaming(true)}>
        {'```ts\nconst example = "<script>"'}
      </ReactMarkdown>,
    )

    expect(html).toContain('sh__token--keyword')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  test('typesets math once its plugins are loaded, streaming or not', () => {
    // The cached typesetter made streaming math affordable (rehypeMathCached.test.ts).
    expect(shouldActivateMath(true, true)).toBe(true)
    expect(shouldActivateMath(true, false)).toBe(false)
    expect(shouldActivateMath(false, true)).toBe(false)
  })

  test('loads math only for math syntax, not ordinary dollar signs', () => {
    expect(hasMathSyntax('Euler wrote $e^{i\\pi} + 1 = 0$.')).toBe(true)
    expect(hasMathSyntax('$$\nE = mc^2\n$$')).toBe(true)
    expect(hasMathSyntax('Spacing is valid: $ x $, $x $, and $  y  $.')).toBe(true)
    expect(hasMathSyntax('A multiline expression: $x +\ny$.')).toBe(true)
    expect(hasMathSyntax('Costs $5 today and $6 tomorrow.')).toBe(false)
    expect(hasMathSyntax('Use `$HOME` or:\n```sh\necho "$PATH"\n```')).toBe(false)
    expect(hasMathSyntax('A multiline code span: `price $5\nand $6`')).toBe(false)
    expect(hasMathSyntax('\\`literal $x$ literal\\`')).toBe(true)
    expect(hasMathSyntax('$x\n\ny$')).toBe(false)
    expect(hasMathSyntax('Shell vars $HOME/$PATH')).toBe(false)
    expect(hasMathSyntax('    echo "$HOME"')).toBe(false)
    expect(hasMathSyntax('Escape the literal \\$ symbol.')).toBe(false)
  })

  test('keeps raw HTML inert until it can be parsed and sanitized once', () => {
    expect(shouldActivateHtml(true, true)).toBe(false)
    expect(shouldActivateHtml(true, false)).toBe(true)
    expect(shouldActivateHtml(false, false)).toBe(false)

    const settled = renderToStaticMarkup(
      <ReactMarkdown rehypePlugins={rehypePluginsFor(true, false)}>
        {'<div onclick="alert(1)">safe<script>bad</script></div>'}
      </ReactMarkdown>,
    )
    expect(settled).toContain('<div>safe</div>')
    expect(settled).not.toContain('onclick')
    expect(settled).not.toContain('<script')
  })

  test('enables raw HTML only for prose, not code examples', () => {
    expect(hasHtmlSyntax('before <div>content</div> after')).toBe(true)
    expect(hasHtmlSyntax('```html\n<div>example</div>\n```')).toBe(false)
    expect(hasHtmlSyntax('Inline `<span>example</span>` stays code.')).toBe(false)
    expect(hasHtmlSyntax('    <section>indented code</section>')).toBe(false)
  })

  test('does not let raw HTML reuse application utility classes', () => {
    const settled = renderToStaticMarkup(
      <ReactMarkdown rehypePlugins={rehypePluginsFor(true, false)}>
        {'<div class="fixed inset-0 z-50">ordinary content</div>'}
      </ReactMarkdown>,
    )

    // The dialect allow-list can leave an empty class attribute after removing every token.
    // It must still reject ALL application utility classes, with the content intact.
    expect(settled).toMatch(/<div(?: class="")?>ordinary content<\/div>/u)
  })

  test('keeps GFM tables and strikethrough parsed before the stream ends', () => {
    const markdown = '| A | B |\n| - | - |\n| 1 | 2 |\n\nAfter ~~old~~ text.'
    const streaming = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={remarkPluginsFor(false)}>{markdown}</ReactMarkdown>,
    )

    expect(streaming).toContain('<table>')
    expect(streaming).toContain('<td>2</td>')
    expect(streaming).toContain('<del>old</del>')
    expect(streaming).toContain('After')
    const rendered = renderToStaticMarkup(
      <MarkdownRendererImpl>{'| A | B |\n| - | - |\n| 1 | 2 |'}</MarkdownRendererImpl>,
    )
    expect(rendered).toContain('lx-markdown-table')
    expect(rendered).not.toContain('role="region"')
    expect(rendered).not.toContain('tabindex="0"')
    expect(tableRequiresKeyboardScroll(401, 400)).toBe(false)
    expect(tableRequiresKeyboardScroll(402, 400)).toBe(true)
  })

  test('bounds parser work for very large streaming responses', () => {
    expect(shouldRenderPlainStreaming(STREAMING_PLAIN_TEXT_THRESHOLD - 1, true)).toBe(false)
    expect(shouldRenderPlainStreaming(STREAMING_PLAIN_TEXT_THRESHOLD, true)).toBe(true)
    expect(shouldRenderPlainStreaming(STREAMING_PLAIN_TEXT_THRESHOLD, false)).toBe(false)
    expect(shouldSmoothStreaming(STREAMING_PLAIN_TEXT_THRESHOLD - 1, true)).toBe(true)
    expect(shouldSmoothStreaming(STREAMING_PLAIN_TEXT_THRESHOLD, true)).toBe(false)
    expect(shouldSmoothStreaming(1, false)).toBe(false)
    expect(shouldDeferOversizedMarkdown(STREAMING_PLAIN_TEXT_THRESHOLD, false, false)).toBe(true)
    expect(shouldDeferOversizedMarkdown(STREAMING_PLAIN_TEXT_THRESHOLD, true, false)).toBe(false)
    expect(shouldDeferOversizedMarkdown(STREAMING_PLAIN_TEXT_THRESHOLD, false, true)).toBe(false)
  })

  test('bounds the live plain-text DOM while preserving context and the latest tail', () => {
    const text = `${'H'.repeat(20_000)}${'M'.repeat(200_000)}${'T'.repeat(20_000)}`
    const bounded = boundPlainStreamingText(text)

    expect(bounded).toHaveLength(STREAMING_PLAIN_TEXT_THRESHOLD)
    expect(bounded.startsWith('H'.repeat(16_000))).toBe(true)
    expect(bounded).toContain('middle content omitted while streaming')
    expect(bounded.endsWith('T'.repeat(20_000))).toBe(true)
    expect(boundPlainStreamingText('short')).toBe('short')
  })

  test('requires explicit opt-in before formatting an oversized settled message', () => {
    const html = renderToStaticMarkup(
      <MarkdownRendererImpl>{'# heading\n'.repeat(13_000)}</MarkdownRendererImpl>,
    )
    expect(html).toContain('Render complete formatted message (may be slow)')
    expect(html).not.toContain('<h1>')
  })
})

describe('mention chips', () => {
  test('the renderer’s own chip schemes survive the URL transform', () => {
    // Before this, the transform stripped every scheme it had no click route for — including
    // the two our own remark plugins mint — so both chips silently rendered as plain text.
    expect(markdownUrlTransform('mention:src%2Fa.ts', 'href')).toBe('mention:src%2Fa.ts')
    expect(markdownUrlTransform('agent:qa', 'href')).toBe('agent:qa')
    expect(classifyMarkdownLink('agent:qa')).toEqual({ kind: 'chip', href: 'agent:qa' })
    // Still never an image source, and still nothing a page could smuggle in.
    expect(markdownUrlTransform('agent:qa', 'src')).toBeUndefined()
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBeUndefined()
  })

  test('a file mention renders as a chip that opens the file — in its own chat only', () => {
    const html = renderToStaticMarkup(
      <WorkItemSessionProvider sessionId="s1">
        <MarkdownRendererImpl linkifyMentions>{'see @src/app.ts please'}</MarkdownRendererImpl>
      </WorkItemSessionProvider>,
    )
    expect(html).toContain('title="Open src/app.ts"')
    // Outside a chat there is no workspace to open it in: the chip is a disabled label.
    const orphan = renderToStaticMarkup(
      <MarkdownRendererImpl linkifyMentions>{'see @src/app.ts please'}</MarkdownRendererImpl>,
    )
    expect(orphan).not.toContain('title="Open src/app.ts"')
    expect(orphan).toContain('disabled=""')
  })
})

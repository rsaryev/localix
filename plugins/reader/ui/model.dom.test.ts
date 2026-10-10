import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { highlightReaderCode } from './code-highlighting'
import {
  findReaderTextRange,
  readerNotePreview,
  readerNoteReferenceStrength,
  readerFragmentTarget,
  readerVisiblePassage,
  sanitizeReaderHtml,
  selectionTargetWithin,
} from './model'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

describe('reader DOM text anchors', () => {
  test('resolves exact and percent-encoded book fragments without selector interpolation', () => {
    const root = document.createElement('article')
    root.innerHTML = '<h2 id="chapter 2">Chapter two</h2><p id="literal%20id">Literal</p>'

    expect(readerFragmentTarget(root, 'chapter%202')?.textContent).toBe('Chapter two')
    expect(readerFragmentTarget(root, '#literal%20id')?.textContent).toBe('Literal')
    expect(readerFragmentTarget(root, '%not-valid')?.textContent).toBeUndefined()
    expect(readerFragmentTarget(root, 'x'.repeat(257))).toBeNull()
  })

  test('anchors the selected occurrence with surrounding context across elements', () => {
    const root = document.createElement('article')
    root.innerHTML =
      '<p>First repeated phrase here.</p><p>Later <strong>repeated phrase</strong> there.</p>'
    document.body.append(root)
    const text = root.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const target = selectionTargetWithin(root, selection)

    expect(target).toEqual({
      quote: 'repeated phrase',
      before: 'First repeated phrase here.Later',
      after: 'there.',
    })
    expect(findReaderTextRange(root, target!)).toMatchObject({
      block: root.querySelector('p:last-child'),
    })
    root.remove()
  })

  test('publishes only blocks intersecting the visible reading surface', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>Previous page</p><p>Visible page passage</p><p>Next page</p>'
    const viewport = document.createElement('div')
    viewport.getBoundingClientRect = () =>
      ({ top: 100, right: 600, bottom: 500, left: 0 }) as DOMRect
    const blocks = Array.from(root.querySelectorAll('p'))
    const rects = [
      { top: 20, right: 500, bottom: 80, left: 20 },
      { top: 150, right: 500, bottom: 220, left: 20 },
      { top: 520, right: 500, bottom: 580, left: 20 },
    ]
    blocks.forEach((block, index) => {
      block.getClientRects = () => [rects[index] as DOMRect] as unknown as DOMRectList
    })

    expect(readerVisiblePassage(root, viewport, root.textContent ?? '', 0)).toBe(
      'Visible page passage',
    )
  })

  test('preserves bounded language hints and highlights code with safe token markup', () => {
    const sanitized = sanitizeReaderHtml(
      '<pre><code class="language-javascript" onclick="bad()">const answer = 42</code></pre>',
    )
    const root = document.createElement('article')
    root.innerHTML = sanitized

    expect(root.querySelector('code')?.className).toBe('language-javascript')
    expect(root.querySelector('code')?.hasAttribute('onclick')).toBe(false)
    expect(highlightReaderCode(root)).toBe(1)
    expect(root.querySelector('code')?.classList.contains('hljs')).toBe(true)
    expect(root.querySelector('.hljs-keyword')?.textContent).toBe('const')
  })

  test('preserves safe note semantics and extracts a bounded footnote preview', () => {
    const sanitized = sanitizeReaderHtml(
      '<p>Text <sup><a href="#fn-1" data-reader-epub-type="noteref" data-reader-role="doc-noteref">1</a></sup></p><aside id="fn-1" data-reader-epub-type="footnote" data-reader-role="doc-footnote"><p>Grounded <a href="https://example.com/source">source note</a>.</p></aside><div data-reader-callout="warning" onclick="bad()">Careful.</div>',
    )
    const root = document.createElement('article')
    root.innerHTML = sanitized
    const anchor = root.querySelector<HTMLAnchorElement>('a[href="#fn-1"]')!

    expect(readerNoteReferenceStrength(anchor)).toBe('definite')
    expect(readerNotePreview(root, 'fn-1')).toMatchObject({
      kind: 'footnote',
      title: 'Footnote',
      text: 'Grounded source note.',
    })
    expect(readerNotePreview(root, 'fn-1')?.html).toContain('https://example.com/source')
    expect(root.querySelector('[data-reader-callout="warning"]')?.hasAttribute('onclick')).toBe(
      false,
    )
  })

  test('keeps telephone links interactive while removing unsupported schemes', () => {
    const root = document.createElement('article')
    root.innerHTML = sanitizeReaderHtml(
      '<a href="tel:+35799123456">Call</a><a href="sms:+35799123456">Text</a>',
    )

    expect(root.querySelector('a')?.getAttribute('href')).toBe('tel:+35799123456')
    expect(root.querySelectorAll('a')[1]?.hasAttribute('href')).toBe(false)
  })

  test('uses a semantic note heading once instead of repeating it in the body', () => {
    const root = document.createElement('article')
    root.innerHTML =
      '<p><a href="#source" data-reader-role="doc-noteref">1</a></p><aside id="source" data-reader-role="doc-footnote"><h6>Source note</h6><p>Exact supporting context.</p></aside>'

    expect(readerNotePreview(root, 'source')).toMatchObject({
      title: 'Source note',
      text: 'Exact supporting context.',
    })
    expect(readerNotePreview(root, 'source')?.html).not.toContain('Source note')
  })

  test('a long note uses the bounded text fallback without changing the reading document', () => {
    const root = document.createElement('article')
    root.innerHTML = `<aside id="long-note" data-reader-role="doc-footnote"><h2>Long note</h2><p>${'x'.repeat(20_000)}</p></aside>`
    const original = root.innerHTML
    const preview = readerNotePreview(root, 'long-note')

    expect(preview?.title).toBe('Long note')
    expect(preview?.text).toBe('x'.repeat(8_000))
    expect(preview?.html).toBe(`<p>${'x'.repeat(8_000)}…</p>`)
    expect(root.innerHTML).toBe(original)
  })

  test('does not mistake dense numeric navigation for footnotes', () => {
    const root = document.createElement('nav')
    root.innerHTML = '<a href="#one">1</a><a href="#two">2</a><a href="#three">3</a>'
    expect(readerNoteReferenceStrength(root.querySelector('a')!)).toBeNull()
  })
})

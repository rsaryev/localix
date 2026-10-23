import { expect, test } from 'bun:test'
import { parse as parseHtml } from 'node-html-parser'
import { parseReaderBytes } from './library'

const readHtml = async (source: string) => {
  const parsed = await parseReaderBytes('book.html', new TextEncoder().encode(source))
  return parseHtml(parsed.chapters[0]!.content)
}

test('HTML chapters remove executable elements, event handlers and unsupported URLs', async () => {
  const root = await readHtml(
    '<body><h1>Book</h1><script>alert(1)</script><iframe src="https://example.com"></iframe>' +
      '<p onclick="alert(1)">Readable text.</p><a id="unsafe" href="javascript:alert(1)">Unsafe</a>' +
      '<a id="safe" href="https://example.com/read">Reference</a>' +
      '<img src="https://example.com/image.png" alt="Remote illustration"/></body>',
  )
  expect(root.querySelectorAll('script,iframe')).toHaveLength(0)
  expect(root.querySelector('p')?.getAttribute('onclick')).toBeUndefined()
  expect(root.querySelector('#unsafe')?.getAttribute('href')).toBeUndefined()
  expect(root.querySelector('#safe')?.getAttribute('href')).toBe('https://example.com/read')
  expect(root.querySelector('#safe')?.getAttribute('rel')).toBe('noreferrer noopener')
  expect(root.querySelector('img')?.getAttribute('src')).toBeUndefined()
  expect(root.querySelector('img')?.getAttribute('alt')).toBe('Remote illustration')
})

test('HTML chapters preserve recognized semantics while rejecting unsupported tokens', async () => {
  const root = await readHtml(
    '<body><h1>Book</h1><a epub:type="NOTEREF unsupported" role="DOC-NOTEREF unsupported" href="#note">1</a>' +
      '<aside id="note" data-type="WARNING unsupported">Note</aside>' +
      '<div data-reader-callout="unsupported">Plain text</div>' +
      '<code class="language-sql">SELECT 1</code></body>',
  )
  expect(root.querySelector('a')?.getAttribute('data-reader-epub-type')).toBe('noteref')
  expect(root.querySelector('a')?.getAttribute('data-reader-role')).toBe('doc-noteref')
  expect(root.querySelector('a')?.getAttribute('epub:type')).toBeUndefined()
  expect(root.querySelector('a')?.getAttribute('role')).toBeUndefined()
  expect(root.querySelector('aside')?.getAttribute('data-reader-callout')).toBe('warning')
  expect(root.querySelector('div')?.getAttribute('data-reader-callout')).toBeUndefined()
  expect(root.querySelector('code')?.getAttribute('class')).toBe('language-sql')
})

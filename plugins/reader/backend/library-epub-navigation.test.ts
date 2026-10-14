import { expect, test } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { parse as parseHtml } from 'node-html-parser'
import { parseReaderBytes } from './library'

test('EPUB navigation derives chapter targets from retained spine entries and removes forged targets', async () => {
  const epub = zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
    ),
    'OPS/package.opf': strToU8(
      '<package><metadata><title>Navigation</title></metadata><manifest>' +
        '<item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="escape" href="../../outside.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/>' +
        '</manifest><spine><itemref idref="one"/><itemref idref="escape"/><itemref idref="two"/></spine></package>',
    ),
    'OPS/Text/one.xhtml': strToU8(
      '<body><h1>First</h1>' +
        '<a id="next" href="two.xhtml#note" data-reader-chapter="99">Next</a>' +
        '<a id="missing" href="missing.xhtml" data-reader-chapter="99">Missing</a>' +
        '<a id="external" href="https://example.com" data-reader-chapter="99">External</a>' +
        '</body>',
    ),
    'OPS/Text/two.xhtml': strToU8('<body><h1>Second</h1><p id="note">Retained chapter.</p></body>'),
    'outside.xhtml': strToU8('<body><h1>Outside</h1><p>Excluded entry sentinel.</p></body>'),
  })
  const parsed = await parseReaderBytes('navigation.epub', epub)
  expect(parsed.chapters.map((chapter) => chapter.id)).toEqual(['one', 'two'])
  expect(JSON.stringify(parsed)).not.toContain('Excluded entry sentinel')
  const root = parseHtml(parsed.chapters[0]!.content)
  expect(root.querySelector('#next')?.getAttribute('data-reader-chapter')).toBe('1')
  expect(root.querySelector('#next')?.getAttribute('data-reader-fragment')).toBe('note')
  expect(root.querySelector('#next')?.getAttribute('href')).toBe('#note')
  expect(root.querySelector('#missing')?.getAttribute('href')).toBeUndefined()
  expect(root.querySelector('#missing')?.getAttribute('data-reader-chapter')).toBeUndefined()
  expect(root.querySelector('#external')?.getAttribute('href')).toBe('https://example.com')
  expect(root.querySelector('#external')?.getAttribute('data-reader-chapter')).toBeUndefined()
})

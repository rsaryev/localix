import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

import { parseReaderBytes, parseReaderDocument, resolveReaderPath } from './library'

function minimalPdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Title (Reader PDF) /Author (Localix) >>',
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(source.length)
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(source)
}

describe('reader library', () => {
  test('splits Markdown into navigable chapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-'))
    await writeFile(join(root, 'manual.md'), '# Manual\n\nIntro.\n\n## Setup\n\nInstall it.')
    const parsed = await parseReaderDocument(root, 'manual.md')
    expect(parsed.document.title).toBe('Manual')
    expect(parsed.document.chapters.map((item) => item.title)).toEqual(['Manual', 'Setup'])
    expect(parsed.chapters[1]?.text).toContain('Install it')
  })

  test('refuses paths outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-'))
    let error: unknown
    try {
      await resolveReaderPath(root, '../outside.txt')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('escapes')
  })

  test('allows an explicitly opened absolute path outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-root-'))
    const external = await mkdtemp(join(tmpdir(), 'localix-reader-external-'))
    const path = join(external, 'outside.md')
    await writeFile(path, '# External book\n\nOpened explicitly.')
    expect(await resolveReaderPath(root, path)).toBe(await realpath(path))
    expect((await parseReaderDocument(root, path)).document.title).toBe('External book')
  })

  test('extracts EPUB metadata, spine order, and sanitized chapter content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-'))
    const epub = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
      ),
      'OPS/package.opf': strToU8(
        '<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Field Notes</dc:title><dc:creator>Ada Reader</dc:creator></metadata><manifest><item id="cover" href="artwork" media-type="image/png" properties="cover-image"/><item id="large" href="large.png" media-type="image/png"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
      ),
      'OPS/artwork': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'OPS/large.png': new Uint8Array(600_000),
      'OPS/one.xhtml': strToU8(
        '<html><body><h1>Opening</h1><img src="large.png" alt="Map"/><p onmouseover="alert(1)">Safe text.<sup><a epub:type="noteref" role="doc-noteref" href="#note-1">1</a></sup> <a href="two.xhtml#details">Continue</a> <a href="https://example.com/reference" data-reader-chapter="99">Reference</a> <a href="tel:+35799123456">Call</a></p><aside epub:type="footnote" role="doc-footnote" id="note-1"><p>Bounded footnote.</p></aside><div data-type="warning"><h6>Warning</h6><p>Semantic warning.</p></div><pre><code class="language-javascript">const safe = true</code></pre><script>alert(1)</script></body></html>',
      ),
      'OPS/two.xhtml': strToU8(
        '<html><body><h1 id="details">Details</h1><p>Linked chapter.</p></body></html>',
      ),
    })
    await writeFile(join(root, 'field-notes.epub'), epub)
    const parsed = await parseReaderDocument(root, 'field-notes.epub')
    expect(parsed.document).toMatchObject({
      title: 'Field Notes',
      author: 'Ada Reader',
    })
    expect(parsed.cover).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(parsed.document.chapters.map((item) => item.title)).toEqual(['Opening', 'Details'])
    expect(parsed.chapters[0]?.content).toContain('Safe text.')
    expect(parsed.chapters[0]?.content).not.toContain('<script')
    expect(parsed.chapters[0]?.content).not.toContain('onmouseover')
    expect(parsed.chapters[0]?.content).toContain('data-reader-chapter="1"')
    expect(parsed.chapters[0]?.content).toContain('data-reader-fragment="details"')
    expect(parsed.chapters[0]?.content).toContain('data-reader-epub-type="noteref"')
    expect(parsed.chapters[0]?.content).toContain('data-reader-role="doc-noteref"')
    expect(parsed.chapters[0]?.content).toContain('data-reader-epub-type="footnote"')
    expect(parsed.chapters[0]?.content).toContain('data-reader-callout="warning"')
    expect(parsed.chapters[0]?.content).not.toContain('epub:type=')
    expect(parsed.chapters[0]?.content).not.toContain(' role=')
    expect(parsed.chapters[0]?.content).toContain('rel="noreferrer noopener"')
    expect(parsed.chapters[0]?.content).toContain('href="tel:+35799123456"')
    expect(parsed.chapters[0]?.content).not.toContain('data-reader-chapter="99"')
    expect(parsed.chapters[0]?.content).toContain('class="language-javascript"')
    expect(parsed.chapters[0]?.content).toContain('data:image/png;base64,')
    expect(parsed.chapters[0]?.content).not.toContain('[chapter truncated]')
    expect(parsed.chapters[0]?.content.endsWith('</pre>')).toBe(true)
    expect(parsed.chapters[1]?.content).toContain('id="details"')
  })

  test('parses media-backed EPUB bytes without a workspace path', async () => {
    const epub = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
      ),
      'book.opf': strToU8(
        '<package><metadata><title>Dropped Book</title></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      ),
      'one.xhtml': strToU8('<html><body><h1>Start</h1><p>Media-backed reading.</p></body></html>'),
    })
    const parsed = await parseReaderBytes('dropped.epub', epub)
    expect(parsed.document.title).toBe('Dropped Book')
    expect(parsed.chapters[0]?.text).toContain('Media-backed reading.')
  })

  test('parses bounded CBZ pages in natural order with comic metadata and cover', async () => {
    const page2 = new Uint8Array([137, 80, 78, 71, 2])
    const page10 = new Uint8Array([137, 80, 78, 71, 10])
    const cbz = zipSync({
      'ComicInfo.xml': strToU8(
        '<ComicInfo><Title>Mesh Illustrated</Title><Writer>Ada Artist</Writer><LanguageISO>en</LanguageISO></ComicInfo>',
      ),
      'pages/10.png': page10,
      'pages/2.png': page2,
    })

    const parsed = await parseReaderBytes('mesh.cbz', cbz)

    expect(parsed.document).toMatchObject({
      format: 'cbz',
      title: 'Mesh Illustrated',
      author: 'Ada Artist',
      language: 'en',
    })
    expect(parsed.document.chapters.map((item) => item.title)).toEqual(['Page 1', 'Page 2'])
    expect(parsed.chapters[0]?.content).toContain(Buffer.from(page2).toString('base64'))
    expect(parsed.chapters[1]?.content).toContain(Buffer.from(page10).toString('base64'))
    expect(parsed.cover).toContain(Buffer.from(page2).toString('base64'))
  })

  test('extracts selectable PDF pages and metadata for the reflowed reading view', async () => {
    const parsed = await parseReaderBytes('manual.pdf', minimalPdf('Hello PDF Reader'))

    expect(parsed.document).toMatchObject({
      format: 'pdf',
      title: 'Reader PDF',
      author: 'Localix',
    })
    expect(parsed.document.chapters).toHaveLength(1)
    expect(parsed.document.chapters[0]?.title).toBe('Page 1')
    expect(parsed.chapters[0]?.text).toContain('Hello PDF Reader')
  })

  test('rejects malformed MOBI input before invoking the format engine', async () => {
    const failure = await parseReaderBytes('broken.mobi', new Uint8Array(96)).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('Invalid MOBI header')
  })
})

describe('oversized books', () => {
  test('are refused on their size before a byte is read', async () => {
    // A sparse 3 GB file: reading it whole fails with Node's own 2 GiB error, so the reader's
    // message proves the refusal came from the stat, not from after a full read.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'reader-huge-')))
    const file = join(root, 'huge.txt')
    await writeFile(file, '')
    await truncate(file, 3 * 1024 * 1024 * 1024)
    await expect(parseReaderDocument(root, 'huge.txt')).rejects.toThrow(
      'larger than the reader limit',
    )
    await rm(root, { recursive: true, force: true })
  })
})

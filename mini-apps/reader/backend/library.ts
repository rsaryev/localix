import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'

import { DOMParser } from '@xmldom/xmldom'
import { isPathWithin, resolveWithin } from '@localixai/path-containment'

import type { ReaderFormat } from '../shared/contracts'
import { READER_FORMAT_SUMMARY, readerFormatFor as formatFor } from '../shared/formats'
import { extractMobi } from './mobi'
import { extractPdf } from './pdf'
import { splitMarkdown, splitPlainText } from './text-formats'
import { MAX_SOURCE_BYTES } from './book-archive'
import { parseEpub } from './epub'
import { parseCbz } from './cbz'
import { sanitizedHtml } from './html-sanitize'
import {
  chapter,
  documentFromChapters,
  escapeHtml,
  titleFromPath,
  type ParsedReaderDocument,
} from './chapters'

/** Names the offending file and what Reader does open — a bare "Unsupported reader
 *  format" told neither the user nor the agent what to do next. */
function unsupportedFormatMessage(path: string): string {
  const extension = extname(path).slice(1).toLowerCase()
  return `${basename(path)} is not a reading format${extension ? ` (.${extension})` : ''}. Reader opens ${READER_FORMAT_SUMMARY}.`
}

function parseHtmlDocument(path: string, source: string, format: 'html' | 'fb2') {
  const xml = format === 'fb2' ? new DOMParser().parseFromString(source, 'text/xml') : null
  const bookTitle = xml?.getElementsByTagName('book-title')[0]?.textContent?.trim()
  const firstName = xml?.getElementsByTagName('first-name')[0]?.textContent?.trim()
  const lastName = xml?.getElementsByTagName('last-name')[0]?.textContent?.trim()
  const author = [firstName, lastName].filter(Boolean).join(' ') || undefined
  const parsed =
    format === 'fb2'
      ? sanitizedHtml(
          Array.from(xml?.getElementsByTagName('section') ?? [])
            .map((section) => {
              const heading = section.getElementsByTagName('title')[0]?.textContent?.trim()
              const paragraphs = Array.from(section.getElementsByTagName('p'))
                .map((item) => `<p>${escapeHtml(item.textContent ?? '')}</p>`)
                .join('')
              return `${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}${paragraphs}`
            })
            .join(''),
        )
      : sanitizedHtml(source)
  const title = bookTitle || parsed.heading || titleFromPath(path)
  return documentFromChapters(
    path,
    format,
    title,
    [chapter(0, title, 'html', parsed.html, parsed.text)],
    { author },
  )
}

async function parsePdf(path: string, bytes: Uint8Array): Promise<ParsedReaderDocument> {
  const extracted = await extractPdf(bytes)
  const title = extracted.title || titleFromPath(path)
  return documentFromChapters(
    path,
    'pdf',
    title,
    extracted.pages.map((page, index) =>
      chapter(index, page.label, 'text', page.text, page.text, `page-${index + 1}`),
    ),
    {
      ...(extracted.author ? { author: extracted.author } : {}),
      ...(extracted.language ? { language: extracted.language } : {}),
    },
  )
}

async function parseMobi(
  path: string,
  bytes: Uint8Array,
  format: Extract<ReaderFormat, 'mobi' | 'azw3'>,
): Promise<ParsedReaderDocument> {
  const extracted = await extractMobi(bytes, format)
  const title = extracted.title || titleFromPath(path)
  const chapters = extracted.sections
    .map((section) => {
      const rendered = sanitizedHtml(section.html)
      return { section, rendered }
    })
    .filter(({ rendered }) => Boolean(rendered.text || /<img\b[^>]*\bsrc=/iu.test(rendered.html)))
    .map(({ section, rendered }, index) =>
      chapter(
        index,
        rendered.heading || section.title,
        'html',
        rendered.html,
        rendered.text,
        section.id,
      ),
    )
  return {
    ...documentFromChapters(path, format, title, chapters, {
      ...(extracted.author ? { author: extracted.author } : {}),
      ...(extracted.language ? { language: extracted.language } : {}),
    }),
    ...(extracted.cover ? { cover: extracted.cover } : {}),
  }
}

export async function parseReaderBytes(
  path: string,
  bytes: Uint8Array,
): Promise<ParsedReaderDocument> {
  const format = formatFor(path)
  if (!format) throw new Error(unsupportedFormatMessage(path))
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('Book is larger than the reader limit')
  if (format === 'epub') return parseEpub(path, bytes)
  if (format === 'cbz') return parseCbz(path, bytes)
  if (format === 'pdf') return parsePdf(path, bytes)
  if (format === 'mobi' || format === 'azw3') return parseMobi(path, bytes, format)
  const source = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (format === 'md') return splitMarkdown(path, source)
  if (format === 'txt') return splitPlainText(path, source)
  return parseHtmlDocument(path, source, format)
}

export async function resolveReaderPath(root: string, requested: string): Promise<string> {
  if (!requested || requested.includes('\0')) throw new Error('Book path is required')
  if (isAbsolute(requested)) return realpath(requested)
  const candidate = resolveWithin(root, requested)
  if (!candidate) throw new Error('Book path escapes the workspace')
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
  if (!isPathWithin(realRoot, realCandidate)) throw new Error('Book path escapes the workspace')
  return realCandidate
}

export async function parseReaderDocument(root: string, requested: string) {
  const target = await resolveReaderPath(root, requested)
  const format = formatFor(target)
  if (!format) throw new Error(unsupportedFormatMessage(target))
  const metadata = await stat(target)
  if (!metadata.isFile()) throw new Error('Book path is not a file')
  // Refuse on the stat, before the read: the byte-length check in `parseReaderBytes` ran only
  // after a multi-GB file had been loaded whole into the API process.
  if (metadata.size > MAX_SOURCE_BYTES) throw new Error('Book is larger than the reader limit')
  const bytes = new Uint8Array(await readFile(target))
  return parseReaderBytes(requested, bytes)
}

export type { ParsedReaderDocument } from './chapters'

import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, posix } from 'node:path'

import { DOMParser } from '@xmldom/xmldom'
import { isAtOrUnder, isPathWithin, resolveWithin } from '@localixai/path-containment'
import { mediaTypeForPath } from '@localixai/plugin-sdk/backend'
import { strFromU8, unzipSync } from 'fflate'
import { parse as parseHtml, type HTMLElement } from 'node-html-parser'

import type { ReaderChapter, ReaderFormat } from '../shared/contracts'
import { READER_FORMAT_SUMMARY, readerFormatFor as formatFor } from '../shared/formats'
import { readerExternalLink, readerHasControlCharacters } from '../shared/link'
import { extractMobi } from './mobi'
import { extractPdf } from './pdf'
import {
  MAX_CHAPTERS,
  chapter,
  documentFromChapters,
  cleanText,
  escapeHtml,
  titleFromPath,
  type ParsedReaderDocument,
} from './chapters'

/** Virtual root every archive-internal entry name is resolved inside. */
const ARCHIVE_ROOT = '/__archive__'
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_EPUB_ENTRIES = 3_000
const MAX_EPUB_UNCOMPRESSED_BYTES = 160 * 1024 * 1024
const MAX_CBZ_IMAGE_BYTES = 4 * 1024 * 1024

/** Names the offending file and what Reader does open — a bare "Unsupported reader
 *  format" told neither the user nor the agent what to do next. */
function unsupportedFormatMessage(path: string): string {
  const extension = extname(path).slice(1).toLowerCase()
  return `${basename(path)} is not a reading format${extension ? ` (.${extension})` : ''}. Reader opens ${READER_FORMAT_SUMMARY}.`
}

function markdownText(value: string): string {
  return cleanText(
    value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/[*_~>#]/g, ''),
  )
}

function splitMarkdown(path: string, source: string): ParsedReaderDocument {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const titleLine = lines.find((line) => /^#\s+/.test(line))
  const title = titleLine?.replace(/^#\s+/, '').trim() || titleFromPath(path)
  const parts: Array<{ title: string; lines: string[] }> = []
  let current = { title, lines: [] as string[] }
  for (const line of lines) {
    const heading = /^#{1,2}\s+(.+?)\s*#*$/.exec(line)
    if (heading && current.lines.some((item) => item.trim())) {
      parts.push(current)
      current = { title: heading[1]!.trim(), lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.some((line) => line.trim())) parts.push(current)
  const chapters = parts.map((part, index) => {
    const content = part.lines.join('\n').trim()
    return chapter(index, part.title, 'markdown', content, markdownText(content))
  })
  return documentFromChapters(path, 'md', title, chapters)
}

function splitPlainText(path: string, source: string): ParsedReaderDocument {
  const normalized = source.replace(/\r\n?/g, '\n').trim()
  const lines = normalized.split('\n')
  const boundary =
    /^(?:chapter|part|\u0433\u043b\u0430\u0432\u0430|\u0447\u0430\u0441\u0442\u044c)\s+[\p{L}\d-]+(?:[.:\s—-].*)?$/iu
  const parts: Array<{ title: string; body: string[] }> = []
  let current = { title: titleFromPath(path), body: [] as string[] }
  for (const line of lines) {
    if (boundary.test(line.trim()) && current.body.some((item) => item.trim())) {
      parts.push(current)
      current = { title: line.trim(), body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.some((item) => item.trim())) parts.push(current)
  if (parts.length === 1 && normalized.length > 45_000) {
    parts.length = 0
    let offset = 0
    while (offset < normalized.length && parts.length < MAX_CHAPTERS) {
      const target = Math.min(normalized.length, offset + 28_000)
      const breakAt = normalized.lastIndexOf('\n\n', target)
      const end = breakAt > offset + 8_000 ? breakAt : target
      parts.push({
        title: `Part ${parts.length + 1}`,
        body: [normalized.slice(offset, end)],
      })
      offset = end
    }
  }
  const title = titleFromPath(path)
  return documentFromChapters(
    path,
    'txt',
    title,
    parts.map((part, index) => {
      const text = cleanText(part.body.join('\n'))
      return chapter(index, part.title, 'text', text, text)
    }),
  )
}

const REMOVED_ELEMENTS =
  'script,style,iframe,object,embed,form,input,button,textarea,select,option,video,audio,canvas,svg,math,link,meta,base'

const READER_EPUB_SEMANTIC_TOKENS = new Set([
  'biblioref',
  'biblioentry',
  'endnote',
  'footnote',
  'glossdef',
  'glossref',
  'note',
  'noteref',
  'rearnote',
  'backlink',
])

const READER_DOCUMENT_ROLE_TOKENS = new Set([
  'definition',
  'doc-biblioref',
  'doc-biblioentry',
  'doc-endnote',
  'doc-footnote',
  'doc-glossref',
  'doc-noteref',
  'doc-backlink',
  'note',
])

const READER_CALLOUT_TOKENS = new Set(['caution', 'important', 'note', 'tip', 'warning'])

function safeSemanticTokens(value: string | undefined, allowed: ReadonlySet<string>): string[] {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((token) => allowed.has(token))
}

/** Preserve only the EPUB semantics Reader actively understands before removing source attributes. */
function preserveReaderSemantics(root: HTMLElement): void {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const epubTypes = safeSemanticTokens(
      element.getAttribute('epub:type') ?? undefined,
      READER_EPUB_SEMANTIC_TOKENS,
    )
    if (epubTypes.length) element.setAttribute('data-reader-epub-type', epubTypes.join(' '))

    const roles = safeSemanticTokens(
      element.getAttribute('role') ?? undefined,
      READER_DOCUMENT_ROLE_TOKENS,
    )
    if (roles.length) element.setAttribute('data-reader-role', roles.join(' '))

    const callout = safeSemanticTokens(
      element.getAttribute('data-type') ?? element.getAttribute('epub:type') ?? undefined,
      READER_CALLOUT_TOKENS,
    )[0]
    if (callout) element.setAttribute('data-reader-callout', callout)
  }
}

function safeUrl(value: string, kind: 'href' | 'src'): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.startsWith('javascript:') || normalized.startsWith('data:text')) {
    return false
  }
  if (kind === 'src') return normalized.startsWith('data:image/')
  return normalized.startsWith('#') || readerExternalLink(value) !== null
}

function sanitizeElementTree(root: HTMLElement): void {
  for (const item of root.querySelectorAll(REMOVED_ELEMENTS)) item.remove()
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const [name, value] of Object.entries(element.attributes)) {
      const lower = name.toLowerCase()
      const keep =
        lower === 'alt' ||
        lower === 'title' ||
        lower === 'lang' ||
        lower === 'dir' ||
        lower === 'colspan' ||
        lower === 'rowspan' ||
        (lower === 'id' && value.length <= 256 && !readerHasControlCharacters(value)) ||
        (lower === 'class' && /^language-[a-z0-9+#.-]{1,32}$/iu.test(value)) ||
        (lower === 'data-reader-chapter' && /^\d{1,3}$/u.test(value)) ||
        (lower === 'data-reader-fragment' &&
          value.length <= 256 &&
          !readerHasControlCharacters(value)) ||
        (lower === 'data-reader-epub-type' &&
          safeSemanticTokens(value, READER_EPUB_SEMANTIC_TOKENS).join(' ') === value) ||
        (lower === 'data-reader-role' &&
          safeSemanticTokens(value, READER_DOCUMENT_ROLE_TOKENS).join(' ') === value) ||
        (lower === 'data-reader-callout' && READER_CALLOUT_TOKENS.has(value)) ||
        (lower === 'href' && safeUrl(value, 'href')) ||
        (lower === 'src' && safeUrl(value, 'src'))
      if (!keep) element.removeAttribute(name)
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href')
      if (readerExternalLink(href)?.newTab) {
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer noopener')
      }
    }
  }
}

function sanitizedHtml(source: string): {
  html: string
  text: string
  heading?: string
} {
  const parsed = parseHtml(source, { lowerCaseTagName: true, comment: false })
  const root = parsed.querySelector('body') ?? parsed
  preserveReaderSemantics(root)
  sanitizeElementTree(root)
  const heading = root.querySelector('h1,h2,h3')?.structuredText.trim()
  return {
    html: root.innerHTML.trim(),
    text: cleanText(root.structuredText),
    heading,
  }
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

function xmlText(document: Document, names: string[]): string | undefined {
  for (const name of names) {
    const value = document.getElementsByTagName(name)[0]?.textContent?.trim()
    if (value) return value
  }
  return undefined
}

function decoded(bytes: Uint8Array | undefined): string {
  return bytes ? strFromU8(bytes) : ''
}

function archivePath(from: string, href: string): string | null {
  const clean = href.split('#', 1)[0]?.split('?', 1)[0]
  if (!clean) return null
  let decodedHref = clean
  try {
    decodedHref = decodeURIComponent(clean)
  } catch {
    // Keep the literal archive name when the EPUB contains malformed percent escapes.
  }
  const target = posix.normalize(posix.join(posix.dirname(from), decodedHref)).replace(/^\/+/, '')
  // Archive entries are named relative to a virtual root, so containment is the same
  // ancestry question the filesystem asks — answered by the owner, not by a `..` sniff.
  return isAtOrUnder(ARCHIVE_ROOT, posix.join(ARCHIVE_ROOT, target), '/') ? target : null
}

/** The raster formats the reader renders from a book archive (never a scriptable SVG). */
const READER_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

function imageMime(path: string): string | null {
  return safeImageMime(mediaTypeForPath(path) ?? '')
}

function safeImageMime(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return READER_IMAGE_TYPES.has(normalized) ? normalized : null
}

function rewriteEpubLinks(
  root: HTMLElement,
  chapterPath: string,
  chapterByPath: ReadonlyMap<string, number>,
): void {
  for (const anchor of root.querySelectorAll('a')) {
    // Navigation metadata is an internal Reader contract. Never trust similarly named attributes
    // supplied by an untrusted book; derive them exclusively from the resolved archive href below.
    anchor.removeAttribute('data-reader-chapter')
    anchor.removeAttribute('data-reader-fragment')
    const href = anchor.getAttribute('href')?.trim()
    if (!href || href.startsWith('#') || readerExternalLink(href)) continue
    const hash = href.indexOf('#')
    const pathPart = hash >= 0 ? href.slice(0, hash) : href
    const fragment = hash >= 0 ? href.slice(hash + 1) : ''
    const target = archivePath(chapterPath, pathPart)
    const targetChapter = target ? chapterByPath.get(target) : undefined
    if (targetChapter === undefined) {
      anchor.removeAttribute('href')
      continue
    }
    anchor.setAttribute('href', fragment ? `#${fragment}` : '#')
    anchor.setAttribute('data-reader-chapter', String(targetChapter))
    if (fragment) anchor.setAttribute('data-reader-fragment', fragment)
  }
}

function epubHtml(
  source: string,
  chapterPath: string,
  files: Record<string, Uint8Array>,
  chapterByPath: ReadonlyMap<string, number> = new Map(),
) {
  const parsed = parseHtml(source, { lowerCaseTagName: true, comment: false })
  const root = parsed.querySelector('body') ?? parsed
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src')
    const target = src ? archivePath(chapterPath, src) : null
    const bytes = target ? files[target] : undefined
    const mime = target ? imageMime(target) : null
    if (!bytes || !mime || bytes.byteLength > 3 * 1024 * 1024) {
      image.removeAttribute('src')
      continue
    }
    image.setAttribute('src', `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`)
  }
  rewriteEpubLinks(root, chapterPath, chapterByPath)
  preserveReaderSemantics(root)
  sanitizeElementTree(root)
  const heading = root.querySelector('h1,h2,h3')?.structuredText.trim()
  return {
    html: root.innerHTML.trim(),
    text: cleanText(root.structuredText),
    heading,
  }
}

/**
 * `unzipSync`, with its own words kept out of the reading pane.
 *
 * fflate answers a truncated or non-zip file with `invalid zip data` / `unexpected EOF` — true, and
 * not a sentence anyone should meet as the reason their book will not open. The bounds thrown from
 * inside the filter below ARE ours and stand as they are; anything else becomes one sentence with
 * the library's text as the cause, which the router forwards as `detail`.
 */
function readArchive(
  bytes: Uint8Array,
  label: string,
  options: Parameters<typeof unzipSync>[1],
): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, options)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(label)) throw cause
    throw new Error(`This ${label} is not a readable archive.`, { cause })
  }
}

function unzipBounded(bytes: Uint8Array, label: string): Record<string, Uint8Array> {
  let acceptedEntries = 0
  let acceptedBytes = 0
  const files = readArchive(bytes, label, {
    filter(entry) {
      if (entry.name.startsWith('__MACOSX/')) return false
      acceptedEntries += 1
      acceptedBytes += entry.originalSize
      if (acceptedEntries > MAX_EPUB_ENTRIES)
        throw new Error(`${label} has too many archive entries`)
      if (acceptedBytes > MAX_EPUB_UNCOMPRESSED_BYTES) {
        throw new Error(`${label} expands beyond the limit`)
      }
      return entry.originalSize <= MAX_SOURCE_BYTES
    },
  })
  const entries = Object.entries(files)
  if (entries.length > MAX_EPUB_ENTRIES) throw new Error(`${label} has too many archive entries`)
  const uncompressed = entries.reduce((sum, [, value]) => sum + value.byteLength, 0)
  if (uncompressed > MAX_EPUB_UNCOMPRESSED_BYTES) {
    throw new Error(`${label} expands beyond the limit`)
  }
  return files
}

function parseEpub(path: string, bytes: Uint8Array): ParsedReaderDocument {
  const files = unzipBounded(bytes, 'EPUB')

  const xml = new DOMParser()
  const container = xml.parseFromString(decoded(files['META-INF/container.xml']), 'text/xml')
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!opfPath || !files[opfPath]) throw new Error('EPUB package document is missing')
  const opf = xml.parseFromString(decoded(files[opfPath]), 'text/xml')
  const title = xmlText(opf, ['dc:title', 'title']) || titleFromPath(path)
  const author = xmlText(opf, ['dc:creator', 'creator'])
  const language = xmlText(opf, ['dc:language', 'language'])

  const manifest = new Map<string, { path: string; mediaType: string; properties: string }>()
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const target = href ? archivePath(opfPath, href) : null
    if (!id || !target) continue
    manifest.set(id, {
      path: target,
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }

  const coverId = Array.from(opf.getElementsByTagName('meta'))
    .find((item) => item.getAttribute('name')?.toLowerCase() === 'cover')
    ?.getAttribute('content')
  let coverItem =
    [...manifest.entries()].find(([, item]) =>
      item.properties.split(/\s+/).includes('cover-image'),
    )?.[1] ??
    (coverId ? manifest.get(coverId) : undefined) ??
    [...manifest.entries()].find(
      ([id, item]) => /cover/i.test(id) && item.mediaType.startsWith('image/'),
    )?.[1] ??
    [...manifest.values()].find(
      (item) => item.mediaType.startsWith('image/') && /(^|[/_.-])cover([/_.-]|$)/i.test(item.path),
    )
  // EPUB 2 often points <meta name="cover"> at an XHTML wrapper rather than
  // directly at the image. Resolve its first image against the wrapper path.
  if (coverItem && !coverItem.mediaType.startsWith('image/') && files[coverItem.path]) {
    const wrapper = parseHtml(decoded(files[coverItem.path]), {
      lowerCaseTagName: true,
    })
    const image = wrapper.querySelector('img,image')
    const source = image?.getAttribute('src') ?? image?.getAttribute('href')
    const target = source ? archivePath(coverItem.path, source) : null
    coverItem = target
      ? ([...manifest.values()].find((item) => item.path === target) ?? {
          path: target,
          mediaType: imageMime(target) ?? '',
          properties: '',
        })
      : undefined
  }
  const coverBytes = coverItem ? files[coverItem.path] : undefined
  const coverMime = coverItem
    ? (safeImageMime(coverItem.mediaType) ?? imageMime(coverItem.path))
    : null
  const cover =
    coverBytes && coverMime && coverBytes.byteLength <= 768 * 1024
      ? `data:${coverMime};base64,${Buffer.from(coverBytes).toString('base64')}`
      : undefined

  const tocTitles = new Map<string, string>()
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'))
  if (nav && files[nav.path]) {
    const navRoot = parseHtml(decoded(files[nav.path]), {
      lowerCaseTagName: true,
    })
    for (const link of navRoot.querySelectorAll('nav a')) {
      const href = link.getAttribute('href')
      const target = href ? archivePath(nav.path, href) : null
      const label = link.structuredText.trim()
      if (target && label && !tocTitles.has(target)) tocTitles.set(target, label)
    }
  }

  const candidates: Array<{
    id: string
    item: { path: string; mediaType: string; properties: string }
    source: string
  }> = []
  for (const itemRef of Array.from(opf.getElementsByTagName('itemref'))) {
    if (candidates.length >= MAX_CHAPTERS) break
    const id = itemRef.getAttribute('idref')
    const item = id ? manifest.get(id) : undefined
    if (!item || !files[item.path] || !/xhtml|html|xml/i.test(item.mediaType)) continue
    const source = decoded(files[item.path])
    const preview = epubHtml(source, item.path, files)
    if (!preview.text && !preview.html) continue
    candidates.push({
      id: id || `chapter-${candidates.length + 1}`,
      item,
      source,
    })
  }
  const chapterByPath = new Map(candidates.map((candidate, index) => [candidate.item.path, index]))
  const chapters: ReaderChapter[] = []
  for (const candidate of candidates) {
    const rendered = epubHtml(candidate.source, candidate.item.path, files, chapterByPath)
    chapters.push(
      chapter(
        chapters.length,
        tocTitles.get(candidate.item.path) || rendered.heading || `Chapter ${chapters.length + 1}`,
        'html',
        rendered.html,
        rendered.text,
        candidate.id,
      ),
    )
  }
  return {
    ...documentFromChapters(path, 'epub', title, chapters, {
      author,
      language,
    }),
    cover,
  }
}

function parseCbz(path: string, bytes: Uint8Array): ParsedReaderDocument {
  const files = unzipBounded(bytes, 'CBZ')
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  const pages = Object.entries(files)
    .filter(([name, value]) => imageMime(name) && value.byteLength <= MAX_CBZ_IMAGE_BYTES)
    .sort(([left], [right]) => collator.compare(left, right))
    .slice(0, MAX_CHAPTERS)
  if (!pages.length) throw new Error('CBZ contains no supported image pages')

  const comicInfoEntry = Object.entries(files).find(([name]) =>
    /(?:^|\/)ComicInfo\.xml$/iu.test(name),
  )
  const comicInfo = comicInfoEntry
    ? new DOMParser().parseFromString(decoded(comicInfoEntry[1]), 'text/xml')
    : null
  const title = (comicInfo && xmlText(comicInfo, ['Title', 'title'])) || titleFromPath(path)
  const author = comicInfo ? xmlText(comicInfo, ['Writer', 'writer']) : undefined
  const language = comicInfo
    ? xmlText(comicInfo, ['LanguageISO', 'languageISO', 'Language'])
    : undefined
  const chapters = pages.map(([name, pageBytes], index) => {
    const mime = imageMime(name)!
    const pageTitle = `Page ${index + 1}`
    const data = `data:${mime};base64,${Buffer.from(pageBytes).toString('base64')}`
    return chapter(
      index,
      pageTitle,
      'html',
      `<figure class="reader-comic-page"><img src="${data}" alt="${escapeHtml(`${pageTitle} · ${basename(name)}`)}"/><figcaption>${escapeHtml(basename(name))}</figcaption></figure>`,
      '',
      `page-${index + 1}`,
    )
  })
  const first = pages[0]
  const coverMime = first ? imageMime(first[0]) : null
  const cover =
    first && coverMime && first[1].byteLength <= 1024 * 1024
      ? `data:${coverMime};base64,${Buffer.from(first[1]).toString('base64')}`
      : undefined
  return {
    ...documentFromChapters(path, 'cbz', title, chapters, { author, language }),
    cover,
  }
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

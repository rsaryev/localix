import { DOMParser } from '@xmldom/xmldom'
import { parse as parseHtml, type HTMLElement } from 'node-html-parser'
import type { ReaderChapter } from '../shared/contracts'
import { readerExternalLink } from '../shared/link'
import {
  decoded,
  archivePath,
  imageMime,
  safeImageMime,
  unzipBounded,
  xmlText,
} from './book-archive'
import { preserveReaderSemantics, sanitizeElementTree } from './html-sanitize'
import {
  MAX_CHAPTERS,
  chapter,
  documentFromChapters,
  cleanText,
  titleFromPath,
  type ParsedReaderDocument,
} from './chapters'

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

export function parseEpub(path: string, bytes: Uint8Array): ParsedReaderDocument {
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

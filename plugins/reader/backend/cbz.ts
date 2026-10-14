import { basename } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { decoded, imageMime, unzipBounded, xmlText } from './book-archive'
import {
  MAX_CHAPTERS,
  chapter,
  documentFromChapters,
  escapeHtml,
  titleFromPath,
  type ParsedReaderDocument,
} from './chapters'

const MAX_CBZ_IMAGE_BYTES = 4 * 1024 * 1024

export function parseCbz(path: string, bytes: Uint8Array): ParsedReaderDocument {
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

import { parseHTML } from 'linkedom'
import { parse as parseHtml } from 'node-html-parser'

import type { ReaderFormat } from '../shared/contracts'
import type {
  FoliateBook,
  FoliateSection,
  FoliateTocItem,
  SerializableDocument,
} from './mobi-contracts'
import { rewriteMobiDocumentLinks } from './mobi-links'

export { rewriteMobiDocumentLinks } from './mobi-links'

const MAX_MOBI_TEXT_BYTES = 160 * 1024 * 1024
const MAX_MOBI_RECORDS = 65_535
const MAX_MOBI_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_MOBI_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024

export interface ExtractedMobi {
  format: Extract<ReaderFormat, 'mobi' | 'azw3'>
  title?: string
  author?: string
  language?: string
  cover?: string
  sections: Array<{ id: string; title: string; html: string }>
}

interface PreparedMobiSection {
  sourceIndex: number
  section: FoliateSection
  document: SerializableDocument
}

const MOBI_DOM_GLOBAL_KEYS = ['document', 'DOMParser', 'XMLSerializer', 'CSS'] as const
let mobiDomLeases = 0
let originalMobiDomGlobals: Map<string, PropertyDescriptor | undefined> | null = null

function acquireServerDom(): () => void {
  const globals = globalThis as Record<string, unknown>
  if (mobiDomLeases === 0) {
    originalMobiDomGlobals = new Map(
      MOBI_DOM_GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    )
    const window = parseHTML('<html><body></body></html>')
    globals.document ??= window.document
    globals.DOMParser ??= window.DOMParser
    globals.XMLSerializer ??= class XMLSerializer {
      serializeToString(node: { toString(): string }) {
        return node.toString()
      }
    }
    globals.CSS ??= {
      escape(value: string) {
        // @safe-file-key-exemption rule -- CSS.escape polyfill for the MOBI DOM shim: it ESCAPES
        // each character as `\<hex> ` so the selector still matches, where a file key must DESTROY
        // them. Same ruling as packages/visual-feedback/src/core/identify.ts. No path is built.
        return String(value).replace(/[^a-zA-Z0-9_-]/gu, (character) => {
          return `\\${character.codePointAt(0)!.toString(16)} `
        })
      },
    }
  }
  mobiDomLeases += 1
  return () => {
    mobiDomLeases -= 1
    if (mobiDomLeases > 0 || !originalMobiDomGlobals) return
    for (const key of MOBI_DOM_GLOBAL_KEYS) {
      const descriptor = originalMobiDomGlobals.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    originalMobiDomGlobals = null
  }
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset)
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

/** Validate the PalmDB table and declared decompressed text budget before Foliate allocates it. */
function validateMobiEnvelope(bytes: Uint8Array): void {
  if (bytes.byteLength < 86 || new TextDecoder().decode(bytes.subarray(60, 68)) !== 'BOOKMOBI') {
    throw new Error('Invalid MOBI header')
  }
  const records = uint16(bytes, 76)
  if (!records || records > MAX_MOBI_RECORDS || 78 + records * 8 > bytes.byteLength) {
    throw new Error('Invalid MOBI record table')
  }
  const record0 = uint32(bytes, 78)
  if (record0 + 12 > bytes.byteLength) throw new Error('Invalid MOBI text header')
  const declaredTextBytes = uint32(bytes, record0 + 4)
  if (declaredTextBytes > MAX_MOBI_TEXT_BYTES) {
    throw new Error('MOBI expands beyond the reader limit')
  }
}

function metadataText(value: unknown, limit = 512): string | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => metadataText(item, limit)).filter(Boolean)
    return items.length ? items.join(', ').slice(0, limit) : undefined
  }
  if (value && typeof value === 'object') {
    return metadataText(Object.values(value as Record<string, unknown>)[0], limit)
  }
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/gu, ' ').trim()
  return clean ? clean.slice(0, limit) : undefined
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

async function embedSectionImages(
  html: string,
  book: FoliateBook,
  cache: Map<string, string | null>,
  budget: { remaining: number },
): Promise<string> {
  const root = parseHtml(html, { lowerCaseTagName: true, comment: false })
  for (const image of root.querySelectorAll('img')) {
    const recindex = image.getAttribute('recindex')
    const kindleUri = image.getAttribute('src')?.startsWith('kindle:')
      ? image.getAttribute('src')
      : undefined
    const key = recindex ? `record:${Number(recindex) - 1}` : kindleUri
    if (!key) continue
    let data = cache.get(key)
    if (data === undefined) {
      try {
        const payload = recindex
          ? await book.mobi?.loadResource(Number(recindex) - 1)
          : (await book.loadResourceBlob?.(kindleUri!))?.[0]
        const bytes =
          payload instanceof Blob
            ? new Uint8Array(await payload.arrayBuffer())
            : payload
              ? new Uint8Array(payload)
              : undefined
        const mime = bytes ? imageType(bytes) : null
        data =
          bytes &&
          mime &&
          bytes.byteLength <= MAX_MOBI_IMAGE_BYTES &&
          bytes.byteLength <= budget.remaining
            ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
            : null
        if (data) budget.remaining -= bytes!.byteLength
      } catch {
        data = null
      }
      cache.set(key, data)
    }
    if (data) image.setAttribute('src', data)
    else image.removeAttribute('src')
    image.removeAttribute('recindex')
  }
  return root.toString()
}

async function tocTitles(book: FoliateBook): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  const visit = async (items: FoliateTocItem[]) => {
    for (const item of items) {
      const label = metadataText(item.label, 240)
      if (label && item.href && book.splitTOCHref) {
        try {
          const resolved = await book.splitTOCHref(item.href)
          const index = Number(resolved[0])
          if (Number.isInteger(index) && index >= 0 && !titles.has(index)) titles.set(index, label)
        } catch {
          // A malformed TOC row must not hide otherwise readable sections.
        }
      }
      if (item.subitems?.length) await visit(item.subitems)
    }
  }
  await visit(book.toc ?? [])
  return titles
}

export async function extractMobi(
  bytes: Uint8Array,
  format: Extract<ReaderFormat, 'mobi' | 'azw3'>,
): Promise<ExtractedMobi> {
  validateMobiEnvelope(bytes)
  const releaseDom = acquireServerDom()
  let book: FoliateBook | null = null
  try {
    const [{ MOBI, isMOBI }, { unzlibSync }] = await Promise.all([
      import('foliate-js/mobi.js'),
      import('fflate'),
    ])
    const blob = new Blob([bytes.slice()])
    if (!(await isMOBI(blob))) throw new Error('Invalid MOBI header')
    book = (await new MOBI({ unzlib: unzlibSync }).open(blob)) as FoliateBook
    const titles = await tocTitles(book)
    const prepared: PreparedMobiSection[] = []
    const imageCache = new Map<string, string | null>()
    const imageBudget = { remaining: MAX_MOBI_TOTAL_IMAGE_BYTES }
    for (let sourceIndex = 0; sourceIndex < Math.min(400, book.sections.length); sourceIndex += 1) {
      const section = book.sections[sourceIndex]
      if (!section?.createDocument || section.linear === 'no') continue
      try {
        const document = await section.createDocument()
        prepared.push({ sourceIndex, section, document })
      } catch {
        // Keep the rest of the book readable if one malformed section fails.
      }
    }
    await rewriteMobiDocumentLinks(prepared, book)
    const sections: ExtractedMobi['sections'] = []
    for (const { sourceIndex, section, document } of prepared) {
      sections.push({
        id: String(section.id ?? `section-${sourceIndex + 1}`),
        title: titles.get(sourceIndex) ?? `Section ${sourceIndex + 1}`,
        html: await embedSectionImages(document.toString(), book!, imageCache, imageBudget),
      })
    }
    const coverBlob = await book.getCover?.().catch(() => undefined)
    const coverBytes = coverBlob ? new Uint8Array(await coverBlob.arrayBuffer()) : undefined
    const coverType =
      coverBytes && coverBytes.byteLength <= 768 * 1024 ? imageType(coverBytes) : null
    return {
      format,
      title: metadataText(book.metadata?.title),
      author: metadataText(book.metadata?.author),
      language: metadataText(book.metadata?.language, 24),
      ...(coverBytes && coverType
        ? { cover: `data:${coverType};base64,${Buffer.from(coverBytes).toString('base64')}` }
        : {}),
      sections,
    }
  } finally {
    book?.destroy?.()
    releaseDom()
  }
}

import { parse as parseHtml, type HTMLElement } from 'node-html-parser'
import { readerExternalLink, readerHasControlCharacters } from '../shared/link'
import { cleanText } from './chapters'

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
export function preserveReaderSemantics(root: HTMLElement): void {
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

export function sanitizeElementTree(root: HTMLElement): void {
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

export function sanitizedHtml(source: string): {
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

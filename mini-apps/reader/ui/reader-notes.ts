import { readerFragmentTarget, sanitizeReaderHtml } from './reader-html'

export type ReaderNoteKind = 'footnote' | 'endnote' | 'note' | 'definition' | 'reference'

export interface ReaderNotePreview {
  fragment: string
  kind: ReaderNoteKind
  title: string
  html: string
  text: string
}

const READER_NOTE_REFERENCE_TYPES = new Set(['biblioref', 'glossref', 'noteref'])
const READER_NOTE_REFERENCE_ROLES = new Set(['doc-biblioref', 'doc-glossref', 'doc-noteref'])

function readerSemanticTokens(element: Element, attribute: string): Set<string> {
  return new Set(
    (element.getAttribute(attribute) ?? '').trim().toLowerCase().split(/\s+/u).filter(Boolean),
  )
}

function readerNumericMarker(value: string | null | undefined): boolean {
  return value != null && /^.{0,2}\d+$/u.test(value.trim())
}

/** Definite EPUB/DPUB references plus a conservative superscript/numeric fallback. */
export function readerNoteReferenceStrength(
  anchor: HTMLAnchorElement,
): 'definite' | 'possible' | null {
  const types = readerSemanticTokens(anchor, 'data-reader-epub-type')
  const roles = readerSemanticTokens(anchor, 'data-reader-role')
  if (
    [...types].some((token) => READER_NOTE_REFERENCE_TYPES.has(token)) ||
    [...roles].some((token) => READER_NOTE_REFERENCE_ROLES.has(token))
  ) {
    return 'definite'
  }
  const marker =
    Boolean(anchor.parentElement?.closest('sup')) ||
    Boolean(anchor.querySelector('sup')) ||
    readerNumericMarker(anchor.textContent)
  if (!marker) return null
  let container: Element | null = anchor.parentElement
  for (let depth = 0; depth < 3 && container; depth += 1) {
    const numericSiblings = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter(
      (candidate) => candidate !== anchor && readerNumericMarker(candidate.textContent),
    ).length
    if (numericSiblings >= 2) return null
    container = container.parentElement
  }
  return 'possible'
}

function readerNoteKind(element: Element): ReaderNoteKind | null {
  const types = readerSemanticTokens(element, 'data-reader-epub-type')
  const roles = readerSemanticTokens(element, 'data-reader-role')
  if (types.has('footnote') || roles.has('doc-footnote')) return 'footnote'
  if (types.has('endnote') || types.has('rearnote') || roles.has('doc-endnote')) return 'endnote'
  if (types.has('biblioentry') || roles.has('doc-biblioentry') || types.has('biblioref'))
    return 'reference'
  if (types.has('glossdef') || roles.has('definition') || types.has('glossref')) return 'definition'
  if (types.has('note') || roles.has('note') || element.hasAttribute('data-reader-callout'))
    return 'note'
  return null
}

const READER_NOTE_TITLES: Record<ReaderNoteKind, string> = {
  footnote: 'Footnote',
  endnote: 'Endnote',
  note: 'Note',
  definition: 'Definition',
  reference: 'Reference',
}

function readerEscapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Extract a bounded, sanitized note fragment without mutating the reading document. */
export function readerNotePreview(
  root: HTMLElement,
  fragment: string,
  referenceStrength: 'definite' | 'possible' = 'definite',
): ReaderNotePreview | null {
  if (!fragment || fragment.length > 256) return null
  const target = readerFragmentTarget(root, fragment)
  if (!target) return null
  const semantic = target.closest<HTMLElement>(
    '[data-reader-epub-type],[data-reader-role],[data-reader-callout]',
  )
  const block = semantic ?? target.closest<HTMLElement>('aside,li,dd,dt,blockquote,p,div') ?? target
  const kind = readerNoteKind(block) ?? readerNoteKind(target)
  if (!kind && referenceStrength !== 'definite') return null
  if (!kind && !block.matches('aside,li,dd,dt,blockquote,p')) return null
  const resolvedKind = kind ?? 'note'
  const previewBlock = block.cloneNode(true) as HTMLElement
  const previewHeading = previewBlock.querySelector('h1,h2,h3,h4,h5,h6')
  const heading = previewHeading?.textContent?.replace(/\s+/gu, ' ').trim()
  if (heading) previewHeading?.remove()
  const text = (previewBlock.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 8_000)
  if (!text) return null
  const sanitized = sanitizeReaderHtml(previewBlock.innerHTML)
  const html =
    sanitized.length <= 16_000
      ? sanitized
      : `<p>${readerEscapeHtml(text)}${text.length >= 8_000 ? '…' : ''}</p>`
  return {
    fragment,
    kind: resolvedKind,
    title: heading || READER_NOTE_TITLES[resolvedKind],
    html,
    text,
  }
}

import { readerExternalLink, readerHasControlCharacters } from '../shared/link'
import type { FoliateBook } from './mobi-contracts'

/**
 * Convert format-owned MOBI/KF8 destinations into Reader's chapter/fragment contract before the
 * shared sanitizer runs. Foliate remains the only layer that understands filepos/kindle positions;
 * the rendered UI receives only bounded fragment ids plus a numeric chapter identity.
 */
export async function rewriteMobiDocumentLinks(
  sections: ReadonlyArray<{ sourceIndex: number; document: Document }>,
  resolver: Pick<FoliateBook, 'resolveHref' | 'isExternal'>,
): Promise<void> {
  const bySourceIndex = new Map(
    sections.map((section, index) => [section.sourceIndex, { ...section, index }]),
  )
  let generatedFragment = 0

  for (const section of sections) {
    const anchors = Array.from(section.document.querySelectorAll<HTMLAnchorElement>('a'))
    for (const anchor of anchors) {
      // Reader navigation metadata is derived from the MOBI resolver, never from book markup.
      anchor.removeAttribute('data-reader-chapter')
      anchor.removeAttribute('data-reader-fragment')
      const filePosition = anchor.getAttribute('filepos')?.trim()
      const href =
        anchor.getAttribute('href')?.trim() || (filePosition ? `filepos:${filePosition}` : '')
      if (!href) continue
      if (href.startsWith('#')) continue

      const safeExternal = readerExternalLink(href)
      const external = resolver.isExternal?.(href) ?? safeExternal !== null
      if (external) {
        if (safeExternal) anchor.setAttribute('href', safeExternal.href)
        else anchor.removeAttribute('href')
        continue
      }

      try {
        const resolved = await resolver.resolveHref?.(href)
        const destination = resolved ? bySourceIndex.get(resolved.index) : undefined
        if (!resolved || !destination) {
          anchor.removeAttribute('href')
          continue
        }
        const target = resolved.anchor?.(destination.document) as HTMLElement | null | undefined
        let fragment = target?.id?.trim() ?? ''
        if (fragment.length > 256 || readerHasControlCharacters(fragment)) fragment = ''
        if (target && !fragment) {
          generatedFragment += 1
          fragment = `reader-mobi-${destination.index + 1}-${generatedFragment}`
          target.id = fragment
        }
        anchor.setAttribute('href', fragment ? `#${fragment}` : '#')
        anchor.setAttribute('data-reader-chapter', String(destination.index))
        if (fragment) anchor.setAttribute('data-reader-fragment', fragment)
        else anchor.removeAttribute('data-reader-fragment')
      } catch {
        anchor.removeAttribute('href')
      }
    }
  }
}

import { readerExternalLink, readerHasControlCharacters } from '../shared/link'

export function sanitizeReaderHtml(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html')
  for (const blocked of document.querySelectorAll(
    'script,style,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas,svg,math,link,meta,base',
  )) {
    blocked.remove()
  }
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      const safe =
        name === 'alt' ||
        name === 'title' ||
        name === 'lang' ||
        name === 'dir' ||
        name === 'colspan' ||
        name === 'rowspan' ||
        (name === 'id' &&
          attribute.value.length <= 256 &&
          !readerHasControlCharacters(attribute.value)) ||
        (name === 'class' && /^language-[a-z0-9+#.-]{1,32}$/iu.test(attribute.value)) ||
        (name === 'data-reader-chapter' && /^\d{1,3}$/u.test(attribute.value)) ||
        (name === 'data-reader-fragment' &&
          attribute.value.length <= 256 &&
          !readerHasControlCharacters(attribute.value)) ||
        (name === 'data-reader-epub-type' &&
          /^(?:(?:biblio(?:ref|entry)|endnote|footnote|gloss(?:def|ref)|note|noteref|rearnote|backlink)(?:\s+|$)){1,4}$/u.test(
            value,
          )) ||
        (name === 'data-reader-role' &&
          /^(?:(?:definition|doc-(?:biblio(?:ref|entry)|endnote|footnote|glossref|noteref|backlink)|note)(?:\s+|$)){1,4}$/u.test(
            value,
          )) ||
        (name === 'data-reader-callout' &&
          /^(?:caution|important|note|tip|warning)$/u.test(value)) ||
        (name === 'src' && value.startsWith('data:image/')) ||
        (name === 'href' &&
          (value.startsWith('#') || readerExternalLink(attribute.value) !== null)) ||
        (name === 'target' && value === '_blank') ||
        (name === 'rel' && value === 'noreferrer noopener')
      if (!safe) element.removeAttribute(attribute.name)
    }
  }
  return document.body.innerHTML
}

/** Resolve EPUB/MOBI fragments without interpolating them into a CSS selector. */
export function readerFragmentTarget(root: ParentNode, rawFragment: string): HTMLElement | null {
  const fragment = rawFragment.startsWith('#') ? rawFragment.slice(1) : rawFragment
  if (!fragment || fragment.length > 256) return null
  const candidates = new Set([fragment])
  try {
    candidates.add(decodeURIComponent(fragment))
  } catch {
    // Malformed escapes still get an exact-id lookup.
  }
  return (
    Array.from(root.querySelectorAll<HTMLElement>('[id]')).find((element) =>
      candidates.has(element.id),
    ) ?? null
  )
}

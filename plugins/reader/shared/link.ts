export type ReaderExternalLink = {
  kind: 'external'
  href: string
  newTab: boolean
}

export type ReaderInternalLink = {
  kind: 'internal'
  chapter: number
  fragment: string
}

export type ReaderLinkTarget = ReaderExternalLink | ReaderInternalLink | { kind: 'inert' }

export interface ReaderLinkAttributes {
  href?: string | null
  chapter?: string | number | null
  fragment?: string | null
}

export function readerHasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => (character.codePointAt(0) ?? 0) < 32)
}

/**
 * Accept only destinations that Localix can hand to an operating-system browser or handler.
 * Keeping this policy shared prevents the parser and event adapter from disagreeing about which
 * links are interactive.
 */
export function readerExternalLink(value: string | null | undefined): ReaderExternalLink | null {
  const href = value?.trim()
  if (!href) return null
  try {
    const parsed = new URL(href)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host) {
      return { kind: 'external', href, newTab: true }
    }
    if (
      (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') &&
      parsed.pathname.length > 0
    ) {
      return { kind: 'external', href, newTab: false }
    }
  } catch {
    // Relative, malformed, and unsupported schemes remain inert below.
  }
  return null
}

/** Classify a sanitized book anchor without consulting browser navigation or application state. */
export function readerLinkTarget(
  attributes: ReaderLinkAttributes,
  currentChapter: number,
): ReaderLinkTarget {
  const href = attributes.href?.trim()
  if (!href) return { kind: 'inert' }
  const external = readerExternalLink(href)
  if (external) return external
  if (!href.startsWith('#')) return { kind: 'inert' }

  const chapterValue =
    typeof attributes.chapter === 'string' ? attributes.chapter.trim() : attributes.chapter
  const linkedChapter =
    chapterValue === '' || chapterValue == null ? Number.NaN : Number(chapterValue)
  const chapter =
    Number.isInteger(linkedChapter) && linkedChapter >= 0 ? linkedChapter : currentChapter
  const fragment = (attributes.fragment ?? href.slice(1)).trim()
  if (fragment.length > 256 || readerHasControlCharacters(fragment)) return { kind: 'inert' }
  return { kind: 'internal', chapter, fragment }
}

/**
 * Parent-level event delegation must never repeat an action already owned by a child control.
 * React keyboard activation reports button 0, while middle-click arrives through `auxclick`.
 */
export function readerLinkGesture(event: {
  defaultPrevented: boolean
  button: number
}): 'primary' | 'auxiliary' | null {
  if (event.defaultPrevented) return null
  if (event.button === 0) return 'primary'
  if (event.button === 1) return 'auxiliary'
  return null
}

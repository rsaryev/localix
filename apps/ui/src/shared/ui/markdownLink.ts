import { defaultUrlTransform } from 'react-markdown'
import { fileHrefToReference, type FileHrefReference } from './markdownFileRef'

export type MarkdownLinkTarget =
  | ({ kind: 'file' } & FileHrefReference)
  | { kind: 'external'; href: string; newTab: boolean }
  /**
   * The renderer's OWN in-app schemes: `mention:` (a file mention chip), `agent:` (an agent
   * mention chip) and `user:` (the reader's own mention). Minted by our remark plugins, never by
   * a model or a page, and consumed by the `a` component — so they must survive the URL
   * transform, which otherwise strips every scheme it has no click route for. Before this kind
   * existed the transform removed them and the chips rendered as plain text, which no test
   * caught — and `user:` reproduced it exactly, the day it was added.
   */
  | { kind: 'chip'; href: string }
  | { kind: 'inert' }

const CHIP_SCHEMES = ['mention:', 'agent:', 'user:'] as const
const isChipHref = (href: string): boolean => CHIP_SCHEMES.some((scheme) => href.startsWith(scheme))

function supportedExternalHref(href: string): { href: string; newTab: boolean } | null {
  try {
    const parsed = new URL(href)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host) {
      return { href, newTab: true }
    }
    if (
      (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') &&
      parsed.pathname.length > 0
    ) {
      return { href, newTab: false }
    }
  } catch {
    // Invalid absolute URLs stay inert below.
  }
  return null
}

/** Classify first; event handlers never infer behavior from browser navigation. */
export function classifyMarkdownLink(href?: string): MarkdownLinkTarget {
  if (!href) return { kind: 'inert' }
  if (isChipHref(href)) return { kind: 'chip', href }
  const file = fileHrefToReference(href)
  if (file) return { kind: 'file', ...file }
  const external = supportedExternalHref(href)
  return external ? { kind: 'external', ...external } : { kind: 'inert' }
}

/**
 * Preserve only links for which the renderer has an explicit click route. The
 * default sanitizer remains authoritative for ordinary image/resource URLs.
 * Returning `undefined` (not `''`) removes unsafe hrefs, preventing an empty
 * anchor from navigating the hash-router back to a fresh chat.
 */
export function markdownUrlTransform(url: string, key: string): string | undefined {
  if (key === 'href') {
    const target = classifyMarkdownLink(url)
    if (target.kind === 'file' || target.kind === 'chip') return url
    if (target.kind === 'external') {
      // react-markdown omits tel: from its default allowlist; the exact-scheme
      // classifier above is the narrow, explicit exception.
      return defaultUrlTransform(url) || (url.toLowerCase().startsWith('tel:') ? url : undefined)
    }
    return undefined
  }
  return defaultUrlTransform(url) || undefined
}

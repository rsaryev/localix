/**
 * HTML → readable plain text + entity decoding for research discovery and reads.
 *
 * No DOM parser — a regex pipeline that drops scripts/styles/comments, turns
 * block-level closers into newlines, strips remaining tags, and decodes the
 * common named + numeric character references. Good enough for reading pages and
 * cleaning search snippets. Pure, zero deps.
 *
 * Also the backing implementation of `ctx.helpers.decodeEntities/htmlToText/
 * stripToText` (features/plugins/native-helpers.ts), so drop-in plugins share
 * this copy instead of inlining their own.
 */

/** Decode the common named + numeric HTML character references. */
export function decodeEntities(s: string): string {
  return (
    s
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;|&#39;/gi, "'")
      // Numeric character references — pages/snippets are full of curly quotes
      // (&#8217;), dashes (&#8211;), hex (&#x2019;); without this they read raw.
      // Guard against out-of-range code points so junk passes through, not throws.
      .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
        const n = Number.parseInt(h, 16)
        return n <= 0x10ffff ? String.fromCodePoint(n) : m
      })
      .replace(/&#(\d+);/g, (m, d) => {
        const n = Number.parseInt(d, 10)
        return n <= 0x10ffff ? String.fromCodePoint(n) : m
      })
  )
}

/** Strip HTML to readable plain text (no DOM parser — good enough for reading pages). */
export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(withoutTags)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extract the document <title>, decoded and whitespace-collapsed, or undefined. */
export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return undefined
  const title = decodeEntities(m[1].replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  return title || undefined
}

/** Strip tags + decode + collapse whitespace — for one-line snippets. */
export function stripToText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

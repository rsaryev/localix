import type { TypeRegistry } from '../registry/registry'

/**
 * What pasted or dropped TEXT becomes, decided by its structure — never by words in it (the
 * repository keeps no vocabulary lists). A lone URL is a link, a fenced block is code with the
 * fence's language, explicit Markdown is a rendered text block, short prose is a sticky note.
 */
export interface TextContent {
  type: string
  props: Record<string, unknown>
}

const FENCE = /^```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?```\s*$/u
const SHORT = { chars: 280, lines: 6 }
// Short forms used to become sticky notes, which print their markers verbatim. Recognize
// Markdown structure (headings, quotes and task boxes), never a word in the person's prose.
const MARKDOWN_BLOCK = /^(?: {0,3}(?:>\s|#{1,6}\s)|[ \t]*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s)/mu

export function contentFromText(text: string, registry: TypeRegistry): TextContent {
  const trimmed = text.trim()
  const url = asWebUrl(trimmed)
  const link = url ? registry.claimUrl(url) : undefined
  if (url && link?.claims?.fromUrl) return { type: link.type, props: link.claims.fromUrl(url) }

  const fenced = FENCE.exec(trimmed)
  // A full Mermaid fence must not be reduced to a smaller grammar (the sequence type's skips what
  // it cannot draw). Only a type that reads the block whole or refuses it takes it natively.
  if (fenced?.[1] === 'mermaid' && registry.get('mermaid')) {
    const source = fenced[2] ?? ''
    for (const spec of registry.all()) {
      if (!spec.exactText || !spec.claimsText?.(source) || !spec.fromText) continue
      const read = spec.fromText(source)
      if (typeof read !== 'string') return { type: spec.type, props: read }
    }
    return { type: 'mermaid', props: { source } }
  }

  if (registry.get('text') && (fenced?.[1] === 'tree' || (!fenced && MARKDOWN_BLOCK.test(trimmed))))
    return { type: 'text', props: { text: trimmed } }

  // A type that owns a text form takes its own (a Mermaid sequence block) before any fence rule.
  for (const spec of registry.all()) {
    if (!spec.claimsText?.(trimmed) || !spec.fromText) continue
    const read = spec.fromText(trimmed.replace(/^```\w*\n?|```$/gu, ''))
    if (typeof read !== 'string') return { type: spec.type, props: read }
  }

  if (fenced && registry.get('code'))
    return { type: 'code', props: { code: fenced[2] ?? '', language: fenced[1] ?? '' } }

  const short = trimmed.length <= SHORT.chars && trimmed.split('\n').length <= SHORT.lines
  return { type: short ? 'note' : 'text', props: { text: trimmed } }
}

export function asWebUrl(text: string): string | null {
  text = text.trim()
  if (/\s/u.test(text)) return null
  try {
    const url = new URL(/^www\./iu.test(text) ? `https://${text}` : text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Plain prose stays plain; only explicit web addresses become interactive spans. */
export function webLinksInText(text: string) {
  const links: { start: number; end: number; text: string; url: string }[] = []
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'`]+/giu)) {
    let label = match[0].replace(/[.,;:!?]+$/u, '')
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]) {
      while (label.endsWith(close!) && label.split(close!).length > label.split(open!).length)
        label = label.slice(0, -1)
    }
    const url = asWebUrl(label)
    if (url) links.push({ start: match.index, end: match.index + label.length, text: label, url })
  }
  return links
}

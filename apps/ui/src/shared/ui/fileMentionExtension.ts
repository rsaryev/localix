// `@path/to/file.ts` in a message's text becomes a link the renderer draws as a clickable file
// chip. The link carries the `mention:` scheme, so the `a` component can tell it from an
// ordinary file link and from the URLs a model writes (which `fileHrefToPath` already handles).
import type { Extension, Node } from 'llx-markdown'
import { FILE_MENTION_RE, mentionPathOf, mentionLabel } from '@/shared/lib/fileMention'

/** Encodes a mention path into the link href the renderer decodes. */
function mentionHref(path: string): string {
  return `mention:${encodeURIComponent(path)}`
}

/** Decodes a `mention:` href back to its path, or null if not a mention link. */
export function mentionPathFromHref(href?: string): string | null {
  if (!href || !href.startsWith('mention:')) return null
  try {
    return decodeURIComponent(href.slice('mention:'.length))
  } catch {
    return null
  }
}

/** A text node as the nodes it becomes: itself, or its text with every mention a link. */
function withMentions(node: Node): Node[] {
  const value = node.value ?? ''
  if (!value.includes('@')) return [node]
  const out: Node[] = []
  let lastEnd = 0
  for (const match of value.matchAll(FILE_MENTION_RE)) {
    const path = mentionPathOf(match[2]!)
    if (!path) continue
    const atStart = match.index + match[1]!.length
    if (atStart > lastEnd) out.push({ type: 'text', value: value.slice(lastEnd, atStart) })
    out.push({
      type: 'link',
      url: mentionHref(path),
      children: [{ type: 'text', value: `@${mentionLabel(path)}` }],
    })
    lastEnd = atStart + 1 + path.length // skip '@' + the matched path
  }
  if (out.length === 0) return [node]
  if (lastEnd < value.length) out.push({ type: 'text', value: value.slice(lastEnd) })
  return out
}

/** Every text under `parent`, except a link's own (a mention inside a link stays its text). */
function linkify(parent: Node): void {
  if (!parent.children) return
  const next: Node[] = []
  for (const child of parent.children) {
    if (child.type === 'text') next.push(...withMentions(child))
    else {
      if (child.type !== 'link') linkify(child)
      next.push(child)
    }
  }
  parent.children = next
}

/** The `llx-markdown` extension for a person's message: its `@path` tokens are file chips. */
export const fileMentions: Extension = { name: 'file-mentions', transform: linkify }

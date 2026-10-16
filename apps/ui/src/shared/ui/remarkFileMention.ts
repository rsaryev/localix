// remark plugin: turn `@path/to/file.ts` mentions in message text into link
// nodes the renderer maps to a clickable file chip. The link carries a custom
// `mention:` scheme so the `a` component can tell it apart from ordinary file
// links and the model-authored URLs (which `fileHrefToPath` already handles).
import { visit } from 'unist-util-visit'
import type { Root, Text, Link } from 'mdast'
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

export function remarkFileMention() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || !parent || parent.type === 'link') return
      const value = node.value
      if (!value.includes('@')) return

      const replacements: (Text | Link)[] = []
      let lastEnd = 0
      FILE_MENTION_RE.lastIndex = 0
      for (const match of value.matchAll(FILE_MENTION_RE)) {
        const path = mentionPathOf(match[2])
        if (!path) continue
        const lead = match[1]
        const atStart = (match.index ?? 0) + lead.length
        if (atStart > lastEnd) {
          replacements.push({ type: 'text', value: value.slice(lastEnd, atStart) })
        }
        replacements.push({
          type: 'link',
          url: mentionHref(path),
          children: [{ type: 'text', value: `@${mentionLabel(path)}` }],
        })
        lastEnd = atStart + 1 + path.length // skip '@' + the matched path
      }
      if (replacements.length === 0) return
      if (lastEnd < value.length) {
        replacements.push({ type: 'text', value: value.slice(lastEnd) })
      }
      parent.children.splice(index, 1, ...replacements)
      return index + replacements.length
    })
  }
}

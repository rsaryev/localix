import type { Element, Root } from 'hast'
import type { ActionTarget } from '@localixai/mini-app-sdk/ui'
import { TREE_FENCE_LANGUAGE } from '@localixai/markdown/dialect'

type MarkdownBlock = Extract<ActionTarget, { kind: 'markdown' }>['block']
function blockKind(node: Element): MarkdownBlock | 'table' | null {
  if (node.tagName === 'figure') return null // Images and diagrams have their own actions.
  if (node.tagName === 'pre') {
    const code = node.children[0]
    if (code?.type !== 'element' || !Array.isArray(code.properties.className)) return null
    if (code.properties.className.includes('language-math')) return 'math'
    // A tree bypasses CodeBlock (and its actions). Carry its exact fence as Markdown so the
    // destination uses the same interactive renderer instead of saving only a nearby heading.
    return code.properties.className.includes(`language-${TREE_FENCE_LANGUAGE}`) ? 'other' : null
  }
  if (node.tagName === 'table') return 'table'
  if (/^h[1-6]$/u.test(node.tagName)) return 'heading'
  if (node.tagName === 'ul' || node.tagName === 'ol') return 'list'
  if (node.tagName === 'blockquote') return node.properties.dataCallout ? 'callout' : 'quote'
  return node.tagName === 'p' ? 'paragraph' : 'other'
}

/** Runs after sanitization and before math typesetting; source offsets retain original syntax. */
export function rehypeContentActions(source: string) {
  return () => (tree: Root) => {
    tree.children = tree.children.map((node) => {
      if (node.type !== 'element') return node
      const block = blockKind(node)
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (!block || start === undefined || end === undefined) return node
      const markdown = source.slice(start, end)
      if (!markdown.trim()) return node
      return {
        type: 'element',
        tagName: 'content-actions',
        properties: { markdownSource: markdown, blockKind: block },
        children: [node],
      } satisfies Element
    })
  }
}

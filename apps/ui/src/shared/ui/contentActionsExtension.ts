import type { Extension, Node } from 'llx-markdown'
import type { ActionTarget } from '@localixai/mini-app-sdk/ui'
import { TREE_FENCE_LANGUAGE } from 'llx-markdown/prompt'

type MarkdownBlock = Extract<ActionTarget, { kind: 'markdown' }>['block']

/** The blocks an action names by what the parser read them as. */
const BLOCK_BY_TYPE: Partial<Record<Node['type'], MarkdownBlock | 'table'>> = {
  math: 'math',
  table: 'table',
  heading: 'heading',
  list: 'list',
  paragraph: 'paragraph',
}

/** What a top-level block is to an action, or null for one that brings its own actions. */
function blockKind(node: Node): MarkdownBlock | 'table' | null {
  // An answer form is drawn as another element than its Markdown says: steps are a list.
  const drawnAs = node.data?.hName
  if (drawnAs === 'figure') return null // Images and diagrams have their own actions.
  if (drawnAs === 'ol' || drawnAs === 'ul') return 'list'
  if (drawnAs !== undefined) return node.type === 'math' ? 'math' : 'other'
  if (node.type === 'code') {
    // A tree bypasses CodeBlock (and its actions). Carry its exact fence as Markdown so the
    // destination uses the same interactive renderer instead of saving only a nearby heading.
    return node.lang === TREE_FENCE_LANGUAGE ? 'other' : null
  }
  if (node.type === 'blockquote') {
    const callout = (node.data?.hProperties as { dataCallout?: unknown } | undefined)?.dataCallout
    return callout ? 'callout' : 'quote'
  }
  return BLOCK_BY_TYPE[node.type] ?? 'other'
}

/**
 * Wraps each top-level block in `content-actions`, carrying the block's own Markdown. It runs on
 * each block `<Markdown>` parses, after the dialect has shaped its forms: `source` is the block's
 * text, and a node's position counts in it. A block that holds raw HTML is left as it is: its
 * tags pair across the nodes around them, and a wrapper between two of them would part the pair.
 */
export const contentActions: Extension = {
  name: 'content-actions',
  transform(root, source) {
    const blocks = root.children
    if (!blocks || blocks.some((node) => node.type === 'html')) return
    root.children = blocks.map((node) => {
      const block = blockKind(node)
      const position = node.position
      if (!block || !position) return node
      const markdown = source.slice(position.start.offset, position.end.offset)
      if (!markdown.trim()) return node
      return {
        type: 'element',
        data: {
          hName: 'content-actions',
          hProperties: { markdownSource: markdown, blockKind: block },
        },
        children: [node],
      } satisfies Node
    })
  },
}

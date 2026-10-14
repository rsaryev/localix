// rehype plugin: typeset remark-math's nodes with KaTeX, remembering every expression it set.
//
// `rehype-katex` typesets every formula on every parse, and a streaming reply is re-parsed
// every throttle tick: 30 formulas cost ~12ms of KaTeX and HTML parsing per tick against ~0.5ms
// for the rest of the markdown, so math could only be switched on once the reply settled and
// was read as raw `$…$` until then. A finished formula never changes, so its typeset nodes are
// cached by source and reused — only an expression the parse has not seen before pays KaTeX.
//
// Same contract as `rehype-katex` (the node shapes remark-math emits, KaTeX's own error
// fallback), so swapping it in changes when work happens, not what is drawn. The cached nodes are
// shared between parses: nothing after this plugin mutates the tree (it runs last, and
// react-markdown only reads it).
import katex from 'katex'
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import { SKIP, visit } from 'unist-util-visit'
import type { Element, ElementContent, Root, RootContent } from 'hast'
import { createBoundedCache } from '@localixai/kit/lib'

type Typeset = { nodes: ElementContent[]; size: number }

const typesetCache = createBoundedCache<string, Typeset>({
  maxEntries: 1_000,
  // Characters of KaTeX HTML: a formula is a few KB, so this holds a long math-heavy session.
  maxWeight: 6_000_000,
  weigh: (entry, key) => entry.size + key.length,
})

function classesOf(element: Element): readonly unknown[] {
  const className = element.properties.className
  return Array.isArray(className) ? className : []
}

function textOf(node: Element | RootContent): string {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return ''
  return node.children.map(textOf).join('')
}

function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, { displayMode, throwOnError: true })
  } catch {
    // KaTeX's own fallback: the source, marked as an error, instead of a thrown render.
    return katex.renderToString(source, { displayMode, throwOnError: false, strict: 'ignore' })
  }
}

/** The typeset nodes for one expression — from the cache when it was set before. */
export function typesetMath(source: string, displayMode: boolean): ElementContent[] {
  const key = `${displayMode ? 'display' : 'inline'}\0${source}`
  const hit = typesetCache.get(key)
  if (hit) return hit.nodes
  const html = renderMath(source, displayMode)
  const nodes = fromHtmlIsomorphic(html, { fragment: true }).children as ElementContent[]
  typesetCache.set(key, { nodes, size: html.length })
  return nodes
}

export default function rehypeMathCached() {
  return (tree: Root) => {
    visit(tree, 'element', (element, index, parent) => {
      if (!parent || index === undefined) return
      // Display math arrives as <pre><code class="language-math math-display">, inline math as
      // <code class="language-math math-inline">; the <pre> is replaced as a whole.
      let source: string
      let displayMode: boolean
      const inner = element.children[0]
      if (
        element.tagName === 'pre' &&
        inner?.type === 'element' &&
        classesOf(inner).includes('language-math')
      ) {
        source = textOf(inner)
        displayMode = true
      } else if (
        classesOf(element).some((name) => name === 'math-inline' || name === 'math-display')
      ) {
        source = textOf(element)
        displayMode = classesOf(element).includes('math-display')
      } else {
        return
      }
      const nodes = typesetMath(source, displayMode)
      parent.children.splice(index, 1, ...nodes)
      return [SKIP, index + nodes.length]
    })
  }
}

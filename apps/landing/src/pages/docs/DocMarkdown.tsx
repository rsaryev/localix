import { Markdown, type MarkdownProps } from 'llx-markdown'
import { highlight } from 'llx-markdown/highlight'

// Module constants: `<Markdown>` keeps what a loader brought, by the loader.
const loadMath = () => import('katex/dist/katex.min.css').then(() => import('llx-markdown/math'))
const loadMermaid = () => import('mermaid')

/**
 * A documentation page: headings with ids for the outline, fences highlighted, and formulas and
 * diagrams loaded the first time a page has one. The static build passes the parsers themselves
 * (`math`, `html`) so the prerendered article is complete without JavaScript.
 */
export function DocMarkdown(props: MarkdownProps) {
  return (
    <Markdown headingIds highlight={highlight} math={loadMath} mermaid={loadMermaid} {...props} />
  )
}

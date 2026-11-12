import { Markdown, type MarkdownProps } from '@localix-ai/flowdown'
import { highlight } from '@localix-ai/flowdown/highlight'

// Module constants: `<Markdown>` keeps what a loader brought, by the loader.
const loadMath = () =>
  import('katex/dist/katex.min.css').then(() => import('@localix-ai/flowdown/math'))
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

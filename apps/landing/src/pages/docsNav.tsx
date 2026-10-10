import { extractMarkdownHeadings } from '@localixai/markdown'

export interface Heading {
  depth: 2 | 3
  text: string
  id: string
}

/** The outline uses the same CommonMark AST and ids as the rendered document. */
export function extractHeadings(content: string): Heading[] {
  return extractMarkdownHeadings(content).filter(
    (heading): heading is Heading => heading.depth === 2 || heading.depth === 3,
  )
}

export { makeMdComponents } from './docs/markdownComponents'

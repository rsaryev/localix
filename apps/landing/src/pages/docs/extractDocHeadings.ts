import { extractHeadings } from '@localix-ai/flowdown'
import type { DocHeading } from './docBootstrap'

/** The outline uses the same CommonMark AST and ids as the rendered document. */
export function extractDocHeadings(content: string): DocHeading[] {
  return extractHeadings(content).filter(
    (heading): heading is DocHeading => heading.depth === 2 || heading.depth === 3,
  )
}

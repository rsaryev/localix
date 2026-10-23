import { appLinkViews } from './app-links'
import type { ElementView } from './contract'
import { drawingViews } from './drawing'
import { fileViews } from './files'
import { flowViews } from './flow'
import { quadrantViews } from './quadrant'
import { mediaViews } from './media'
import { sequenceViews } from './sequence'
import { shapeViews } from './shapes'
import { tableViews } from './table'
import { mindmapViews } from './mindmap'
import { penViews } from './pen'
import { mermaidViews } from './mermaid'

/**
 * Every element type's view — the list a new type's view is added to, beside its spec in
 * `shared/types/index.ts`. `elements.test.ts` holds the two lists in lockstep.
 */
export const ELEMENT_VIEWS: readonly ElementView[] = [
  ...drawingViews,
  ...shapeViews,
  ...flowViews,
  ...quadrantViews,
  ...sequenceViews,
  ...mermaidViews,
  ...tableViews,
  ...mindmapViews,
  ...penViews,
  ...fileViews,
  ...mediaViews,
  ...appLinkViews,
]

const byType = new Map(ELEMENT_VIEWS.map((view) => [view.type, view]))

export const viewOf = (type: string) => byType.get(type)

/** What the tool rail offers, in its order. */
export const INSERTABLE = ELEMENT_VIEWS.filter((view) => view.insert).sort(
  (a, b) => (a.insert?.order ?? 0) - (b.insert?.order ?? 0),
)

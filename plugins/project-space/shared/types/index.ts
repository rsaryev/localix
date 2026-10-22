import { createTypeRegistry } from '../registry/registry'
import { refType } from './app-links'
import { codeType, frameType, noteType, shapeType, textType } from './drawing'
import { documentType, fileType, folderType, imageType, linkType } from './references'
import { flowType } from './flow'
import { quadrantType } from './quadrant'
import { sequenceType } from './sequence'
import { tableType } from './table'
import { mindmapType } from './mindmap'
import { penType } from './pen'
import { mermaidType } from './mermaid'

/**
 * Every element type this build ships — the ONE list a new type is added to (its view goes in
 * `ui/elements/index.ts`). The order is the order the agent's guide and the insert menu list
 * them in, so the everyday types come first.
 */
export const ELEMENT_TYPES = [
  noteType,
  textType,
  shapeType,
  frameType,
  flowType,
  sequenceType,
  quadrantType,
  mermaidType,
  tableType,
  mindmapType,
  penType,
  codeType,
  fileType,
  folderType,
  imageType,
  documentType,
  linkType,
  refType,
] as const

export const spaceTypes = createTypeRegistry(ELEMENT_TYPES)

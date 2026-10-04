import { fileId, ROOT_DIR_ID } from '../../shared/ids'
import type { NodeSummaryView } from '../../shared/view'

/**
 * Where to stand to SEE a node: the level on which it is drawn as a box. A directory or a file is
 * a box in its parent directory; a symbol is a box in its file. Jumping to a relation from the side
 * panel goes there and selects it, so the person always lands looking at the thing they clicked —
 * not inside it, with its own box nowhere on screen.
 */
export function levelFor(
  node: Pick<NodeSummaryView, 'id' | 'kind' | 'path' | 'parent'>,
): string | null {
  switch (node.kind) {
    case 'directory':
      return node.parent ?? ROOT_DIR_ID
    case 'file':
      return node.parent ?? ROOT_DIR_ID
    case 'package':
      return null
    case 'class':
    case 'interface':
    case 'type':
    case 'enum':
    case 'function':
    case 'method':
    case 'variable':
      return fileId(node.path)
  }
}

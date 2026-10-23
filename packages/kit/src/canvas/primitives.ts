/**
 * The flow library's names a board's own nodes need, re-exported from the host's ONE copy.
 *
 * A mini app that bundled its own `@xyflow/react` would get a second store context: its `Handle`
 * would look for a provider the host's `Canvas` never gave it, and throw. So a node reaches the
 * library only through here (`scripts/canvas-surface-guard.test.ts`), and a name is added when a
 * board needs it — this list is the review, not an `export *`.
 *
 * An editable board (Project Space) adds `NodeResizer` for its selection handles and
 * `NodeToolbar` for the floating bar above a selection, which the library keeps pinned to the
 * nodes at any zoom. `ViewportPortal` draws in BOARD coordinates above the nodes — alignment
 * guides while a drag snaps, the outline of a group, a placement preview — so an overlay moves and
 * scales with the camera for free.
 */
export {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlowProvider as CanvasProvider,
  ViewportPortal,
} from '@xyflow/react'
export type { Connection, Edge, Node, NodeChange, NodeProps, NodeTypes } from '@xyflow/react'

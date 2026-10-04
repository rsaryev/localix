import { Handle, Position } from '@xyflow/react'

/**
 * Anchors an edge routes to, drawn as nothing. A read-only board still needs handles — the flow
 * library routes every edge between two of them — but a visible dot on a box that cannot be
 * connected invites a drag that does nothing. `!` wins over the library's own handle styles.
 */
export const HIDDEN_HANDLE = '!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0'

/** In on the left, out on the right: the reading direction of every layered layout here. */
export function HiddenHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className={HIDDEN_HANDLE}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={HIDDEN_HANDLE}
        isConnectable={false}
      />
    </>
  )
}

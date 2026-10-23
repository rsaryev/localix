import type { KeyboardEvent, RefObject } from 'react'
import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { viewOf } from '../elements'
import { PenLayer } from './PenLayer'
import { PlacementGhost } from './PlacementGhost'
import type { useTools } from './useTools'

/**
 * What an armed tool lays over the board: a freehand tool's drawing surface, or the ghost of the
 * element a click will place. Nothing while selecting or panning.
 */
export function ToolLayer({
  root,
  tools,
  space,
  commit,
  select,
  onBoardKey,
}: {
  root: RefObject<HTMLDivElement | null>
  tools: ReturnType<typeof useTools>
  space: SpaceDocument
  commit: (ops: readonly SpaceOp[]) => void
  select: (ids: Iterable<string>) => void
  onBoardKey: (event: KeyboardEvent<HTMLDivElement>) => boolean
}) {
  if (viewOf(tools.tool)?.insert?.gesture === 'draw')
    return (
      <PenLayer
        onBoardKey={onBoardKey}
        type={tools.tool}
        toolProps={tools.toolProps}
        space={space}
        commit={commit}
        select={select}
        finish={() => {
          if (!tools.locked) tools.setTool('select')
        }}
        cancel={() => tools.setTool('select')}
      />
    )
  if (tools.tool === 'select' || tools.tool === 'hand') return null
  return <PlacementGhost root={root} tool={tools.tool} toolProps={tools.toolProps} />
}

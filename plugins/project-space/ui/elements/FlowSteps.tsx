import { useState } from 'react'
import type { FlowLayout } from '../../shared/types/flow-layout'
import type { FlowNode } from '../../shared/types/flow-text'
import { InlineText } from './InlineText'

/**
 * A selected flowchart's steps, renamed where they stand: a double-click on a step opens its
 * label for typing — the name, and on the lines after it the technical sublabels — and a
 * double-click on the chart's ground still opens the whole Mermaid text. The chart lays itself
 * out again around the new name.
 *
 * The hit boxes are HTML over the drawing, not part of it: the SVG stays a picture the pointer
 * passes through, and only a selected chart offers steps to rename.
 */
export function FlowSteps({
  nodes,
  layout,
  selected,
  rename,
}: {
  nodes: readonly FlowNode[]
  layout: FlowLayout
  selected: boolean
  rename: (id: string, label: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  if (!selected && renaming === null) return null
  return nodes.map((node) => {
    const box = layout.nodes.get(node.id)
    if (!box) return null
    const style = { left: box.x, top: box.y, width: box.w, height: box.h }
    if (renaming === node.id)
      return (
        <div
          key={node.id}
          className="space-flow-rename nodrag absolute z-(--z-raised) flex items-center rounded-md border border-ring bg-popover px-2"
          style={style}
        >
          <InlineText
            value={node.label}
            onCommit={(label) => rename(node.id, label.trim() || node.label)}
            onDone={() => setRenaming(null)}
            submitOnEnter
            className="text-center text-xs font-semibold"
          />
        </div>
      )
    return (
      <div
        key={node.id}
        aria-hidden
        title={`Double-click to rename “${node.label.split('\n')[0]}”`}
        className="absolute cursor-text"
        style={style}
        onDoubleClick={(event) => {
          event.stopPropagation()
          setRenaming(node.id)
        }}
      />
    )
  })
}

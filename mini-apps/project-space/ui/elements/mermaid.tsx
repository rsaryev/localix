import { Network, Workflow } from 'lucide-react'
import { MermaidDiagram } from '@localixai/kit/markdown'
import { flowType } from '../../shared/types/flow'
import { CodeArea } from './CodeArea'
import { codeHighlighter } from './highlight'
import { defineView, type ElementViewProps } from './contract'

const highlight = codeHighlighter('mermaid')
type MermaidProps = { source: string; title: string }

function MermaidView({ props, editing, commit, stopEditing }: ElementViewProps<MermaidProps>) {
  if (editing)
    return (
      <div className="nowheel h-full overflow-auto">
        <CodeArea
          value={props.source}
          highlight={highlight}
          onCommit={(source) => commit({ source })}
          onDone={stopEditing}
          className="p-3"
          label="Edit Mermaid source"
        />
      </div>
    )
  return (
    <div
      className="pointer-events-none size-full overflow-hidden"
      role="img"
      aria-label={props.title || 'Mermaid diagram'}
    >
      <MermaidDiagram source={props.source} embedded />
    </div>
  )
}

export const mermaidViews = [
  defineView({
    type: 'mermaid',
    View: MermaidView,
    Icon: Workflow,
    editable: true,
    chrome: 'bare',
    insert: { order: 9, description: 'Draw any Mermaid diagram and edit its source' },
    actions: [
      {
        // A flowchart the board can draw whole becomes a native one in the same place: its steps
        // turn editable, focal-aware and laid out by the board. Anything else stays a picture.
        label: 'Draw natively',
        Icon: Network,
        ops: ({ id, props }) => {
          const read = flowType.claimsText?.(props.source)
            ? flowType.fromText?.(props.source)
            : null
          if (!read || typeof read === 'string') return null
          // The same record, now a flowchart: its connectors, groups and stacking stay.
          return [{ op: 'update', id, type: 'flow', props: { ...read, title: props.title } }]
        },
      },
    ],
  }),
]

import { useRef, useState } from 'react'
import { Check, Code2, GitBranch, Plus, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { toast } from '@localixai/plugin-sdk/ui'
import { layoutMindmap } from '../../shared/types/mindmap-layout'
import { readMindmap, writeMindmap } from '../../shared/types/mindmap-text'
import { mindmapType, type MindmapProps } from '../../shared/types/mindmap'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { codeHighlighter } from './highlight'
import { defineView, type ElementViewProps } from './contract'
import { colorControl } from './controls'
import { InlineText } from './InlineText'
import { MindmapParent } from './MindmapParent'
import { addMindNode, moveMindBranch, removeMindBranch } from '../../shared/types/mindmap-ops'
import { cn } from '@localixai/plugin-sdk/ui/classes'

function MindmapView({ props, editing, commit, stopEditing }: ElementViewProps<MindmapProps>) {
  const layout = layoutMindmap(props.nodes)
  const boxes = new Map(layout.boxes.map((box) => [box.node.id, box]))
  const [focus, setFocus] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [source, setSource] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current =
    props.nodes.find((node) => node.id === focus) ?? props.nodes.find((node) => !node.parent)!
  const done = () => {
    setSource(false)
    setTyping(false)
    stopEditing()
  }
  const add = (parent: string) => {
    const nodes = addMindNode(props.nodes, parent)
    if (!nodes) return
    commit({ nodes })
    setFocus(nodes.at(-1)!.id)
    setTyping(true)
  }
  const remove = () => {
    const nodes = removeMindBranch(props.nodes, current.id)
    if (!nodes) return
    commit({ nodes })
    setFocus(current.parent!)
    setTyping(false)
  }
  return (
    <div ref={root} className={`flex h-full w-full flex-col space-tone-${props.color}`}>
      <CardTitle
        Icon={GitBranch}
        title={props.nodes.find((node) => !node.parent)?.text || 'Mind map'}
        actions={
          editing && (
            <>
              {!source && (
                <>
                  <IconButton
                    size="xs"
                    disabled={props.nodes.length >= 200}
                    aria-label="Add child idea"
                    tooltip="Add child idea"
                    onClick={() => add(current.id)}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                  <IconButton
                    size="xs"
                    disabled={!current.parent || props.nodes.length >= 200}
                    aria-label="Add sibling idea"
                    tooltip="Add sibling idea (Shift+Enter)"
                    onClick={() => current.parent && add(current.parent)}
                  >
                    <GitBranch className="size-3.5" />
                  </IconButton>
                  <MindmapParent
                    nodes={props.nodes}
                    id={current.id}
                    onPick={(parent) => {
                      const nodes = moveMindBranch(props.nodes, current.id, parent)
                      if (nodes) commit({ nodes })
                    }}
                  />
                  <IconButton
                    size="xs"
                    disabled={!current.parent}
                    aria-label="Delete branch"
                    tooltip="Delete selected branch"
                    onClick={remove}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                  <IconButton
                    size="xs"
                    aria-label="Edit mind map as Mermaid"
                    tooltip="Edit as Mermaid"
                    onClick={() => setSource(true)}
                  >
                    <Code2 className="size-3.5" />
                  </IconButton>
                </>
              )}
              <IconButton
                size="xs"
                aria-label="Finish editing mind map"
                tooltip="Done"
                onClick={done}
              >
                <Check className="size-3.5" />
              </IconButton>
            </>
          )
        }
      />
      {editing && source ? (
        <div className="nowheel min-h-0 flex-1 overflow-auto">
          <CodeArea
            value={writeMindmap(props)}
            highlight={codeHighlighter('mermaid')}
            label="Edit the mind map as Mermaid"
            className="p-3"
            onDone={done}
            onCommit={(text) => {
              const read = readMindmap(text)
              if (typeof read === 'string') toast.error(`Mind map: ${read}`)
              else {
                const parsed = mindmapType.props.safeParse({ ...props, ...read })
                if (parsed.success) commit(read)
                else toast.error(parsed.error.issues[0]!.message)
              }
            }}
          />
        </div>
      ) : (
        <svg
          role={editing ? 'group' : 'img'}
          aria-label="Mind map"
          className="min-h-0 w-full flex-1"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMinYMid meet"
          onDoubleClickCapture={(event) => {
            const id = (event.target as Element)
              .closest('[data-mind-node]')
              ?.getAttribute('data-mind-node')
            if (id) {
              setFocus(id)
              setTyping(true)
            }
          }}
        >
          {layout.edges.map((edge) => {
            const from = boxes.get(edge.from)!,
              to = boxes.get(edge.to)!
            const x = from.x + from.w,
              y = from.y + from.h / 2,
              ty = to.y + to.h / 2
            return (
              <path
                key={edge.to}
                d={`M ${x} ${y} C ${x + 30} ${y}, ${to.x - 30} ${ty}, ${to.x} ${ty}`}
                fill="none"
                className="space-mindmap-edge"
              />
            )
          })}
          {layout.boxes.map((box) => (
            <g key={box.node.id} data-mind-node={box.node.id}>
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={8}
                className={cn(
                  'space-mindmap-node',
                  editing && current.id === box.node.id && 'space-mindmap-node-selected',
                )}
              />
              <foreignObject x={box.x + 10} y={box.y + 6} width={box.w - 20} height={box.h - 12}>
                {editing && typing && current.id === box.node.id ? (
                  <InlineText
                    submitOnEnter
                    value={box.node.text}
                    className="text-center text-xs leading-4"
                    onCommit={(text) => {
                      if (text.trim())
                        commit({
                          nodes: props.nodes.map((node) =>
                            node.id === box.node.id ? { ...node, text } : node,
                          ),
                        })
                    }}
                    onDone={() => {
                      if (document.activeElement?.tagName === 'TEXTAREA')
                        requestAnimationFrame(() =>
                          root.current
                            ?.querySelector<HTMLButtonElement>(
                              `[data-mind-node="${current.id}"] button`,
                            )
                            ?.focus({ preventScroll: true }),
                        )
                      setTyping(false)
                    }}
                  />
                ) : editing ? (
                  <button
                    type="button"
                    aria-label={`Idea: ${box.node.text}`}
                    aria-pressed={current.id === box.node.id}
                    onFocus={() => setFocus(box.node.id)}
                    className="nodrag flex h-full w-full items-center justify-center overflow-hidden rounded-sm text-center text-xs leading-4 text-foreground outline-none"
                    onClick={(event) => {
                      event.stopPropagation()
                      setFocus(box.node.id)
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setFocus(box.node.id)
                      setTyping(true)
                    }}
                    onKeyDown={(event) => {
                      if (event.metaKey || event.ctrlKey) return
                      event.stopPropagation()
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        if (event.shiftKey && box.node.parent) add(box.node.parent)
                        else setTyping(true)
                      } else if (event.key === 'Insert') {
                        event.preventDefault()
                        add(box.node.id)
                      } else if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault()
                        remove()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        done()
                      }
                    }}
                  >
                    <span className="line-clamp-8 whitespace-pre-wrap break-words">
                      {box.node.text}
                    </span>
                  </button>
                ) : (
                  <div className="pointer-events-none flex h-full items-center justify-center overflow-hidden text-center text-xs leading-4 text-foreground">
                    <span className="line-clamp-8 whitespace-pre-wrap break-words">
                      {box.node.text}
                    </span>
                  </div>
                )}
              </foreignObject>
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

export const mindmapViews = [
  defineView({
    type: 'mindmap',
    View: MindmapView,
    Icon: GitBranch,
    editable: true,
    chrome: 'card',
    controls: [colorControl],
    insert: {
      order: 8,
      key: 'm',
      description: 'Edit ideas and branches visually; import or edit Mermaid mindmap',
    },
  }),
]

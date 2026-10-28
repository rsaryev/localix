import { memo, type MouseEvent } from 'react'
import { Lock, Plus } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { Handle, HIDDEN_HANDLE, NodeResizer, Position, type NodeProps } from '@localixai/kit/canvas'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'
import { ELEMENT_CARD } from '../elements/surface'
import { useBoard, useBoardFlag } from './context'
import { isElementControl, protectControlDrag, useControlFocus } from './interaction'
import type { ElementNode as ElementNodeType } from './toFlow'

/**
 * Every element on the board, whatever its type: the node looks the type's view up and draws the
 * rest itself — the card, the selection ring, the resize handles, the four connector handles, the
 * locked badge, and the placeholder for an element it cannot draw. So a new type writes its
 * content and nothing else, and every type answers the pointer the same way.
 *
 * An element whose props cannot be read (an unknown type, a newer build's, invalid props) is
 * still an element: it can be moved, resized and deleted, and it shows why its content is not
 * drawn. Its props stay in the file exactly as they were.
 */
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

function ElementNodeImpl({ id, data, selected, width, height }: NodeProps<ElementNodeType>) {
  const board = useBoard()
  const focusControl = useControlFocus(() => board.focus(id))
  const { element, read } = data
  const spec = spaceTypes.get(element.type)
  const view = viewOf(element.type)
  const drawable = read.status === 'ok' && view
  const beingEdited = useBoardFlag((flags) => flags.editing === id)
  const alone = useBoardFlag((flags) => flags.single === id)
  const editing = beingEdited && drawable && view.editable
  const size = { width: width ?? element.w, height: height ?? element.h }

  const card = !drawable || view.chrome === 'card'
  const keepAspect =
    drawable &&
    (typeof view.keepAspect === 'function' ? view.keepAspect(read.props) : view.keepAspect)

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!drawable || element.locked || editing || isElementControl(event.target)) return
    if (view.editable) board.setEditing(id)
    else view.open?.(read.props, board.sessionId)
  }
  // Only a whole box is written: the library once reported NaN here, which JSON writes as null
  // and the board refused. Anything else ends the live resize without a write.
  const onResizeEnd = (next: { x: number; y: number; width: number; height: number }) => {
    const box = [next.x, next.y, next.width, next.height].map(Math.round)
    if (!box.every(Number.isFinite)) return board.apply([])
    const [x, y, w, h] = box as [number, number, number, number]
    board.apply([{ op: 'update', id, x, y, w, h }])
  }

  return (
    <div
      className="group relative h-full w-full"
      data-space-editor={editing || undefined}
      onMouseDownCapture={(event) => protectControlDrag(event.target)}
      onTouchStartCapture={(event) => protectControlDrag(event.target)}
      onDoubleClick={onDoubleClick}
    >
      <NodeResizer
        isVisible={selected && !element.locked}
        minWidth={spec?.minSize?.w ?? 24}
        minHeight={spec?.minSize?.h ?? 24}
        keepAspectRatio={Boolean(keepAspect)}
        // The handles keep one screen size through `--space-zoom` (space.css); the library's own
        // scaling only enlarges them when zoomed out and would double that.
        autoScale={false}
        onResizeEnd={(_event, next) => onResizeEnd(next)}
      />
      {/* A visible source dot to drag a connector from, and an invisible target under it: the
          library draws an edge only between a source and a TARGET handle, and with sources
          alone every connector in the file was silently left undrawn. */}
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side} className="space-dot" />
      ))}
      {/* Quick create: one selected element grows a connected twin on any side. */}
      {alone &&
        !element.locked &&
        !spec?.container &&
        view?.insert &&
        SIDES.map((side) => (
          <IconButton
            key={`grow-${side}`}
            size="xs"
            aria-label={`Add a connected ${spec?.label.toLowerCase() ?? 'element'} ${side === Position.Top ? 'above' : side === Position.Bottom ? 'below' : `on the ${side}`}`}
            data-side={side}
            // Size and place are the board's screen-size chrome (`.space-grow` in space.css).
            className={cn(
              FLOATING_SURFACE,
              'space-grow nodrag absolute z-(--z-controls) rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
            )}
            onClick={(event) => {
              event.stopPropagation()
              board.grow(id, side)
            }}
          >
            <Plus aria-hidden />
          </IconButton>
        ))}
      {SIDES.map((side) => (
        <Handle
          key={`${side}-in`}
          id={side}
          type="target"
          position={side}
          className={HIDDEN_HANDLE}
        />
      ))}
      {/* The content, faded by the element's opacity; the ring and the handles around it are
          the board's and stay crisp, so a faint background is still plainly selected. */}
      {/* No role of its own: it only passes on what the widgets inside it do (focus, keys). */}
      <div
        role="presentation"
        onClickCapture={(event) => {
          // Capture sees clicks a widget stops. Select after its native change event finishes:
          // selecting during capture can replace a controlled checkbox before it saves its tick.
          // Portalled menus belong to their widget, not to the card beneath their screen position.
          if (
            !editing &&
            !element.locked &&
            event.button === 0 &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            event.currentTarget.contains(event.target as Node) &&
            isElementControl(event.target)
          )
            focusControl()
        }}
        onKeyDown={(event) => {
          if (isElementControl(event.target)) event.stopPropagation()
        }}
        className={cn(
          'h-full w-full',
          card && ELEMENT_CARD,
          card && selected && 'space-card-selected',
          data.missing && 'border-dashed border-status-warning/60',
        )}
        style={element.opacity !== undefined ? { opacity: element.opacity } : undefined}
      >
        {drawable ? (
          <view.View
            id={id}
            props={read.props}
            {...size}
            selected={selected}
            editing={Boolean(editing)}
            missing={data.missing}
            sessionId={board.sessionId}
            stamp={data.stamp}
            commit={(props) => board.apply([{ op: 'update', id, props }])}
            resize={({ w, h }) => {
              if (!element.locked) board.apply([{ op: 'update', id, w, h }])
            }}
            stopEditing={() => board.setEditing(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
            <span className="font-mono text-2xs text-text-soft">{element.type}</span>
            <span className="text-3xs text-text-faint">
              {read.status === 'unknown'
                ? 'This build does not know this element type; it is kept as it is.'
                : read.status === 'newer'
                  ? 'Made by a newer Project Space; update the app to edit it.'
                  : read.status === 'invalid'
                    ? `Its data is not valid (${read.message}); fix it in the board file.`
                    : 'No view for this type.'}
            </span>
          </div>
        )}
      </div>
      {/* Exactly one outline marks a selection: a card's own border (above), a shape's own
          outline with its handles, or — for an element with no edge at all — this ring. */}
      {selected && !card && !(drawable && view.outlined) && (
        <div aria-hidden className="space-selected pointer-events-none absolute rounded-sm" />
      )}
      {/* A locked element lets the pointer through (`space-locked`); this badge alone takes
          it, so the lock that made it scenery is also the way back. */}
      {element.locked && (
        <IconButton
          size="xs"
          aria-label="Unlock"
          tooltip="Locked — click to unlock"
          className={cn(
            FLOATING_SURFACE,
            'space-unlock nodrag absolute right-1.5 top-1.5 rounded-full',
          )}
          onClick={(event) => {
            event.stopPropagation()
            board.apply([{ op: 'update', id, locked: false }])
          }}
        >
          <Lock aria-hidden className="size-3" />
        </IconButton>
      )}
    </div>
  )
}

export const ElementNode = memo(ElementNodeImpl)

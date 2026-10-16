import { Copy, ExternalLink, Group, Lock, LockOpen, PenLine, Trash2, Ungroup } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { NodeToolbar, Position } from '@localixai/kit/canvas'
import { formatChordText } from '@localixai/kit/keybindings'
import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { duplicateOps } from '../content/clipboard'
import type { ElementControl } from '../elements/contract'
import { viewOf } from '../elements'
import { groupOps, lockOps, ungroupOps, type Selected } from './commands'
import { ConnectionsMenu } from './ConnectionsMenu'
import type { BoardReading } from './useReading'
import { BarDivider, BarSurface, ChoicePicker, ColorPicker } from './pickers'
import { ArrangeMenu, OpacityMenu, StackMenu } from './SelectionMenus'

/**
 * The floating bar over selected elements: the controls
 * the selected TYPES declare, then what every element has — edit, open, its connections, opacity, align and
 * arrange, stacking, group, lock, duplicate, delete, each written by `commands.ts` exactly as its
 * key writes it. Only controls every selected type shares are offered, so a colour pick over a note and
 * a shape recolours both and a shape-kind pick never reaches the note. The flow library keeps the
 * bar pinned above the selection as the camera moves.
 */
export function SelectionBar({
  space,
  ids,
  entered,
  sessionId,
  commit,
  onEdit,
  reading,
  focus,
}: {
  space: SpaceDocument
  ids: readonly string[]
  entered: string | null
  sessionId: string
  commit: (ops: readonly SpaceOp[]) => void
  onEdit: (id: string) => void
  reading: BoardReading
  /** Select as a deliberate focus: the camera goes there. */
  focus: (ids: readonly string[]) => void
}) {
  const elements = ids.flatMap((id) => (space.elements[id] ? [{ id, ...space.elements[id] }] : []))
  if (elements.length === 0) return null
  const controls = shared(elements.map((element) => viewOf(element.type)?.controls ?? []))
  const valueOf = (prop: string) => {
    const values = new Set(
      elements.map((element) => {
        const value = element.props[prop]
        return typeof value === 'string' ? value : ''
      }),
    )
    return values.size === 1 ? [...values][0] : undefined
  }
  const write = (prop: string, value: string) =>
    commit(elements.map((element) => ({ op: 'update', id: element.id, props: { [prop]: value } })))
  const single = elements.length === 1 ? elements[0] : undefined
  const view = single ? viewOf(single.type) : undefined
  const read = single
    ? spaceTypes.read(single.type, single.props, space.typeVersions[single.type])
    : undefined
  const locked = elements.every((element) => element.locked)
  const selection: Selected = { space, ids, entered }
  const ungroup = ungroupOps(selection)
  const group = groupOps(selection)
  // One button: a selection that is a group offers to take it apart, any other one to make one.
  const grouping = ungroup
    ? { label: 'Ungroup', Icon: Ungroup, chord: 'mod+shift+g', ops: ungroup }
    : group
      ? { label: 'Group', Icon: Group, chord: 'mod+g', ops: group }
      : null

  return (
    <NodeToolbar
      nodeId={elements.map((element) => element.id)}
      isVisible
      position={Position.Top}
      offset={14}
    >
      <BarSurface>
        {view && (
          <>
            <span
              aria-label={spaceTypes.get(view.type)?.label}
              className="flex size-6 shrink-0 items-center justify-center text-text-faint"
            >
              <view.Icon aria-hidden className="size-3.5" />
            </span>
            <BarDivider />
          </>
        )}
        {controls.map((control) =>
          control.kind === 'color' ? (
            <ColorPicker
              key={control.prop}
              label={control.label}
              value={valueOf(control.prop)}
              onPick={(value) => write(control.prop, value)}
            />
          ) : (
            <ChoicePicker
              key={control.prop}
              control={control}
              value={valueOf(control.prop)}
              onPick={(value) => write(control.prop, value)}
            />
          ),
        )}
        {controls.length > 0 && <BarDivider />}
        {single && view?.editable && !single.locked && (
          <IconButton
            size="sm"
            aria-label="Edit"
            tooltip="Edit (Enter)"
            onClick={() => onEdit(single.id)}
          >
            <PenLine className="size-3.5" />
          </IconButton>
        )}
        {single && view?.open && read?.status === 'ok' && (
          <IconButton
            size="sm"
            aria-label="Open"
            tooltip="Open"
            onClick={() => view.open?.(read.props, sessionId)}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        )}
        {single && <ConnectionsMenu space={space} id={single.id} reading={reading} focus={focus} />}
        <OpacityMenu selection={selection} commit={commit} />
        <ArrangeMenu selection={selection} commit={commit} />
        <StackMenu selection={selection} commit={commit} />
        {grouping && (
          <IconButton
            size="sm"
            aria-label={grouping.label}
            tooltip={`${grouping.label} (${formatChordText(grouping.chord)})`}
            onClick={() => commit(grouping.ops)}
          >
            <grouping.Icon className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          size="sm"
          aria-label={locked ? 'Unlock' : 'Lock'}
          tooltip={`${locked ? 'Unlock' : 'Lock'} (${formatChordText('mod+shift+l')})`}
          onClick={() => {
            const ops = lockOps(selection)
            if (ops) commit(ops)
          }}
        >
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Duplicate"
          tooltip="Duplicate"
          onClick={() => commit(duplicateOps(space, ids))}
        >
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Delete"
          tooltip="Delete"
          onClick={() => commit(elements.map((element) => ({ op: 'delete', id: element.id })))}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </BarSurface>
    </NodeToolbar>
  )
}

/** The controls present, by prop, in every one of the lists. */
function shared(lists: readonly (readonly ElementControl[])[]): ElementControl[] {
  const [first = [], ...rest] = lists
  return first.filter((control) =>
    rest.every((list) =>
      list.some((other) => other.prop === control.prop && other.kind === control.kind),
    ),
  )
}

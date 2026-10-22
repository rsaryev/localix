import {
  Copy,
  ExternalLink,
  Group,
  Lock,
  LockOpen,
  PenLine,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react'
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
import { SwitchTypeMenu } from './SwitchTypeMenu'
import { FilterMenu } from './FilterMenu'
import { rememberLook } from './lastLook'
import type { BoardReading } from './useReading'
import { BarDivider, BarSurface, ChoicePicker, ColorPicker, StyleMenu } from './pickers'
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
  select,
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
  /** Select without moving the camera: a filter narrows what is already in view. */
  select: (ids: readonly string[]) => void
}) {
  const elements = ids.flatMap((id) => (space.elements[id] ? [{ id, ...space.elements[id] }] : []))
  if (elements.length === 0) return null
  const { offered, controls, textControls } = barControls(
    elements.map((element) => viewOf(element.type)?.controls ?? []),
  )
  // Values as each type READS them, defaults filled: a note written before it had a face is
  // set in sans, not "mixed". An empty value is a value (a snippet's "Plain text"); a colour
  // picker reads it as the automatic colour.
  const readProps = elements.map((element) => {
    const read = spaceTypes.read(element.type, element.props, space.typeVersions[element.type])
    return read.status === 'ok' ? read.props : element.props
  })
  const valueOf = (prop: string) => sharedValue(readProps, prop)
  /** `null` returns the prop to its default, as the update op reads it. */
  const write = (prop: string, value: string | null) => {
    for (const type of new Set(elements.map((element) => element.type)))
      rememberLook(type, { [prop]: value })
    commit(elements.map((element) => ({ op: 'update', id: element.id, props: { [prop]: value } })))
  }
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
        <StyleMenu
          label="Text"
          Icon={Type}
          controls={textControls}
          valueOf={valueOf}
          onPick={write}
        />
        {offered.length > 0 && <BarDivider />}
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
        {single &&
          read?.status === 'ok' &&
          !single.locked &&
          view?.actions?.map((action) => {
            const ops = action.ops({ id: single.id, element: single, props: read.props, space })
            return ops ? (
              <IconButton
                key={action.label}
                size="sm"
                aria-label={action.label}
                tooltip={action.label}
                onClick={() => commit(ops)}
              >
                <action.Icon className="size-3.5" />
              </IconButton>
            ) : null
          })}
        <FilterMenu space={space} ids={ids} select={select} />
        {single && <SwitchTypeMenu space={space} id={single.id} commit={commit} />}
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

/** The value every selected element has for `prop`, or undefined where they differ ("mixed"). */
export function sharedValue(
  props: readonly Record<string, unknown>[],
  prop: string,
): string | undefined {
  const values = new Set(props.map((each) => (typeof each[prop] === 'string' ? each[prop] : '')))
  return values.size === 1 ? [...values][0] : undefined
}

/**
 * What the bar offers for a selection: the controls every selected type shares, split into those
 * that stand on the bar and those gathered into its one Text menu.
 */
export function barControls(lists: readonly (readonly ElementControl[])[]) {
  const offered = shared(lists)
  return {
    offered,
    controls: offered.filter((control) => control.group !== 'text'),
    textControls: offered.filter((control) => control.group === 'text'),
  }
}

/**
 * The controls present in every one of the lists. A choice is shared only when it offers the same
 * values: a note's sizes (`auto`, `sm`…) and a shape's (`s`, `m`…) are both "Text size", and a
 * pick from one written to the other was a value its type refuses.
 */
function shared(lists: readonly (readonly ElementControl[])[]): ElementControl[] {
  const [first = [], ...rest] = lists
  const same = (a: ElementControl, b: ElementControl) =>
    a.prop === b.prop &&
    a.kind === b.kind &&
    (a.kind !== 'choice' ||
      (b.kind === 'choice' &&
        a.options.map((option) => option.value).join() ===
          b.options.map((option) => option.value).join()))
  return first.filter((control) => rest.every((list) => list.some((other) => same(control, other))))
}

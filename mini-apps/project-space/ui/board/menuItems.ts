import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpLeft,
  BringToFront,
  Copy,
  Download,
  ExternalLink,
  Frame,
  Group,
  Image,
  Keyboard,
  Lock,
  LockOpen,
  Maximize,
  PaintBucket,
  Paintbrush,
  PenLine,
  Replace,
  Search,
  SendToBack,
  SquareDashedMousePointer,
  SquarePlus,
  StickyNote,
  Trash2,
  Ungroup,
} from 'lucide-react'
import type { SpaceDocument } from '../../shared/format/document'
import { reachCounts, type ReachDirection } from '../../shared/graph/reach'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { duplicateOps } from '../content/clipboard'
import { viewOf } from '../elements'
import {
  groupOps,
  insertOnEdgeOps,
  lockOps,
  pasteStyleOps,
  reverseEdgeOps,
  stackOps,
  styleOf,
  ungroupOps,
  type Selected,
} from './commands'
import type { StyleClipboard } from './boardKeys'
import { isSwitchable, SWITCHABLE, switchTypeOps } from './switchType'
import type { BoardReading } from './useReading'

/**
 * What a right-click offers, by what was clicked — an element (or the selection it belongs to), a
 * connector, or the empty ground. Every item is a command the board already has — the selection
 * bar's, the keys', the connections menu's — so the menu teaches the same key the item names and
 * can never do a second, different thing. An item that does not apply is left out, not greyed.
 */
export type MenuTarget =
  | { kind: 'elements'; ids: readonly string[] }
  | { kind: 'edge'; id: string }
  | { kind: 'ground'; at: { x: number; y: number } }

export interface MenuItem {
  label: string
  Icon: LucideIcon
  chord?: string
  danger?: boolean
  run: () => void
}

export interface MenuContext {
  space: SpaceDocument
  entered: string | null
  sessionId: string
  reading: BoardReading
  commit: (ops: readonly SpaceOp[]) => void
  edit: (id: string) => void
  copyImage: (ids: readonly string[]) => void
  /** The same picture as a PNG file. */
  saveImage: (ids: readonly string[]) => void
  addNote: (at: { x: number; y: number }) => void
  selectAll: () => void
  fit: () => void
  openFind: () => void
  openShortcuts: () => void
  /** The style ⌥⌘C copied, shared with the keys. */
  style: StyleClipboard
  /** Put the selection in a new frame and name it. */
  frame: (ids: readonly string[]) => void
}

type Sections = MenuItem[][]

const op = (
  label: string,
  Icon: LucideIcon,
  ops: SpaceOp[] | null,
  commit: MenuContext['commit'],
  chord?: string,
): MenuItem[] => (ops ? [{ label, Icon, ...(chord ? { chord } : {}), run: () => commit(ops) }] : [])

export function menuSections(target: MenuTarget, context: MenuContext): Sections {
  if (target.kind === 'edge') return edgeSections(target.id, context)
  if (target.kind === 'ground') return groundSections(target.at, context)
  return elementSections(target.ids, context)
}

function elementSections(ids: readonly string[], context: MenuContext): Sections {
  const { space, commit } = context
  const selection: Selected = { space, ids, entered: context.entered }
  const single = ids.length === 1 ? ids[0] : undefined
  const element = single ? space.elements[single] : undefined
  const view = element ? viewOf(element.type) : undefined
  const read = element
    ? spaceTypes.read(element.type, element.props, space.typeVersions[element.type])
    : undefined
  const locked = ids.every((id) => space.elements[id]?.locked)

  const first: MenuItem[] = []
  if (single && element && view?.editable && !element.locked)
    first.push({ label: 'Edit', Icon: PenLine, chord: 'enter', run: () => context.edit(single) })
  if (single && view?.open && read?.status === 'ok')
    first.push({
      label: 'Open',
      Icon: ExternalLink,
      run: () => view.open?.(read.props, context.sessionId),
    })

  if (single && element && !element.locked && read?.status === 'ok')
    for (const action of view?.actions ?? []) {
      const ops = action.ops({ id: single, element, props: read.props, space })
      if (ops) first.push({ label: action.label, Icon: action.Icon, run: () => commit(ops) })
    }

  if (single && element && isSwitchable(element.type))
    for (const type of SWITCHABLE) {
      const ops = switchTypeOps(space, single, type)
      const label = spaceTypes.get(type)?.label.toLowerCase() ?? type
      if (ops) first.push({ label: `Turn into ${label}`, Icon: Replace, run: () => commit(ops) })
    }

  const traces: MenuItem[] = []
  if (single) {
    const counts = reachCounts(space, single, context.reading.links)
    const trace = (direction: ReachDirection, count: number, Icon: LucideIcon) =>
      count > 0
        ? [
            {
              label: `Trace ${direction} · ${count}`,
              Icon,
              run: () => context.reading.toggleTrace(single, direction),
            },
          ]
        : []
    traces.push(
      ...trace('upstream', counts.upstream, ArrowUpLeft),
      ...trace('downstream', counts.downstream, ArrowDownRight),
    )
  }

  const arrange = [
    ...op('Bring to front', BringToFront, stackOps(selection, 'front'), commit, 'mod+alt+]'),
    ...op('Send to back', SendToBack, stackOps(selection, 'back'), commit, 'mod+alt+['),
    ...op('Group', Group, groupOps(selection), commit, 'mod+g'),
    ...op('Ungroup', Ungroup, ungroupOps(selection), commit, 'mod+shift+g'),
    {
      label: 'Frame the selection',
      Icon: Frame,
      chord: 'mod+alt+g',
      run: () => context.frame(ids),
    },
    ...op(
      locked ? 'Unlock' : 'Lock',
      locked ? LockOpen : Lock,
      lockOps(selection),
      commit,
      'mod+shift+l',
    ),
  ]
  const unlocked = ids.filter((id) => !space.elements[id]?.locked)
  const copied = context.style.copied()
  const style = single ? styleOf(space, single) : null
  const styles: MenuItem[] = [
    ...(style
      ? [
          {
            label: 'Copy style',
            Icon: Paintbrush,
            chord: 'mod+alt+c',
            run: () => context.style.copy(style),
          },
        ]
      : []),
    ...op(
      'Paste style',
      PaintBucket,
      copied ? pasteStyleOps(selection, copied) : null,
      commit,
      'mod+alt+v',
    ),
  ]
  const last: MenuItem[] = [
    ...op('Duplicate', Copy, duplicateOps(space, ids), commit, 'mod+d'),
    { label: 'Copy as image', Icon: Image, run: () => context.copyImage(ids) },
    { label: 'Save as image…', Icon: Download, run: () => context.saveImage(ids) },
    ...op(
      'Delete',
      Trash2,
      unlocked.length ? unlocked.map((id) => ({ op: 'delete' as const, id })) : null,
      commit,
      'delete',
    ).map((item) => ({ ...item, danger: true })),
  ]
  return [first, traces, arrange, styles, last].filter((section) => section.length)
}

function edgeSections(id: string, context: MenuContext): Sections {
  const edge = context.space.edges[id]
  if (!edge) return []
  return [
    [
      {
        label: 'Reverse',
        Icon: ArrowLeftRight,
        run: () => context.commit(reverseEdgeOps(id, edge)),
      },
      {
        label: 'Insert a shape',
        Icon: SquarePlus,
        run: () => {
          const insert = insertOnEdgeOps(context.space, id)
          if (insert) context.commit(insert.ops)
        },
      },
    ],
    [
      {
        label: 'Delete connector',
        Icon: Trash2,
        chord: 'delete',
        danger: true,
        run: () => context.commit([{ op: 'delete', id }]),
      },
    ],
  ]
}

function groundSections(at: { x: number; y: number }, context: MenuContext): Sections {
  const empty = Object.keys(context.space.elements).length === 0
  return [
    [{ label: 'Add a note here', Icon: StickyNote, chord: 'n', run: () => context.addNote(at) }],
    empty
      ? []
      : [
          { label: 'Find…', Icon: Search, chord: '/', run: context.openFind },
          {
            label: 'Select all',
            Icon: SquareDashedMousePointer,
            chord: 'mod+a',
            run: context.selectAll,
          },
          { label: 'Fit the board', Icon: Maximize, chord: 'shift+1', run: context.fit },
          { label: 'Copy the board as image', Icon: Image, run: () => context.copyImage([]) },
          { label: 'Save the board as image…', Icon: Download, run: () => context.saveImage([]) },
        ],
    [{ label: 'Keyboard shortcuts', Icon: Keyboard, chord: 'shift+/', run: context.openShortcuts }],
  ].filter((section) => section.length)
}

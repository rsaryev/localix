import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { IconComponent } from '@localixai/mini-app-sdk/ui'
import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'

/**
 * The VIEW half of an element type: how it draws, what it offers a person. The data half —
 * props, sizes, text, claims — is its spec in `shared/types`; the two meet by `type` and
 * `ui/elements/elements.test.ts` proves every spec has a view and every view a spec.
 *
 * A view draws only its CONTENT. The node around it — selection, resizing, connector handles,
 * the locked and missing states, placeholders for props it cannot read — is the board's
 * (`ui/board/ElementNode.tsx`), so a new type never re-implements any of that and every type
 * behaves the same way under the pointer.
 */
export interface ElementViewProps<P = Record<string, unknown>> {
  id: string
  props: P
  width: number
  height: number
  selected: boolean
  /** Inline editing, entered with a double-click on an `editable` type. */
  editing: boolean
  /** The referenced path is gone from disk. */
  missing: boolean
  sessionId: string
  /** When the referenced file last changed on disk: a view that shows a file re-reads on it. */
  stamp: number
  /** Write props (merged); one undo step. */
  commit: (props: Partial<P>) => void
  /**
   * Ask for another size — a view that learns its content's proportions only when it loads (an
   * image) fits its element to them. The board refuses it for a locked element.
   */
  resize: (size: { w: number; h: number }) => void
  stopEditing: () => void
}

export interface ElementView<P = Record<string, unknown>> {
  type: string
  View: ComponentType<ElementViewProps<P>>
  Icon: LucideIcon
  /** Double-click edits the element in place (its text, its title). */
  editable?: boolean
  /** The node draws a card around the content; a `bare` type draws its own edge (text, shapes). */
  chrome: 'card' | 'bare'
  /**
   * A bare type that draws its own OUTLINE (a shape, a frame): selected, it shows its handles and
   * no ring — a ring beside an outline read as a double border. A card's border turns the
   * selection colour instead, and an outline-less bare type (text, a picture) gets the ring.
   */
  outlined?: boolean
  /**
   * Offered on the tool rail — types a person makes from nothing, not references. `key` is its
   * one-letter shortcut, the design tools' where they agree (N note, T text, S shape, F frame).
   */
  insert?: {
    order: number
    key?: string
    props?: Partial<P>
    /** Everyday tools stay in the rail; all insertable types remain in the searchable catalog. */
    primary?: boolean
    description?: string
    /** A choice control offered before placement, such as a shape's kind. */
    variantProp?: string
    /**
     * The tool's variants when they are not all values of the element's own prop — the pen's
     * eraser is a way of using the pen, not a kind of stroke an element can be.
     */
    variants?: Extract<ElementControl, { kind: 'choice' }>
    /** Ask for a web address before arming placement, rather than inventing a default URL. */
    input?: 'link'
    /** Freehand tools capture a pointer stroke instead of placing a preset on click. */
    gesture?: 'draw'
  }
  /** Resizing keeps the proportions (an image shown whole, but not one that fills and crops). */
  keepAspect?: boolean | ((props: P) => boolean)
  /** The element's "open": a file in the editor, a link in the browser. */
  open?: (props: P, sessionId: string) => void
  /**
   * What the floating bar over a selection offers for this type, as data: the bar draws a swatch
   * row for a `color`, a picker for a `choice`, and writes the prop — so a new type gets its
   * controls by declaring them, and the bar never learns a type's name.
   */
  controls?: readonly ElementControl[]
  /**
   * What can be DONE to an element of this type beyond its props — turn a flowchart into shapes,
   * draw a Mermaid picture natively — as operations, offered on the bar and the right-click menu.
   * `ops` answers null where the action does not apply to these props.
   */
  actions?: readonly ElementAction<P>[]
}

export interface ElementAction<P = Record<string, unknown>> {
  label: string
  Icon: LucideIcon
  ops: (target: {
    id: string
    element: SpaceElement
    props: P
    space: SpaceDocument
  }) => SpaceOp[] | null
}

/**
 * `group: 'text'` gathers a control into the bar's one Text menu (face, size, alignment, ink), so
 * a type with five text settings adds one icon to the bar, not five. `Icon` is what a choice
 * shows on the bar when its current option has no icon of its own.
 */
export type ElementControl =
  | { kind: 'color'; prop: string; label: string; group?: 'text' }
  | {
      kind: 'choice'
      prop: string
      label: string
      Icon?: IconComponent
      group?: 'text'
      /** An option's glyph can be any component: a face's name drawn in that face. */
      options: readonly { value: string; label: string; Icon?: IconComponent }[]
    }

/** Views are typed by their props; the registry holds them as the general shape. */
export const defineView = <P>(view: ElementView<P>) => view as unknown as ElementView

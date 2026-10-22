/**
 * The elements a mod draws with: `$.ui.resolve(e)` hands out these constructors, and a JSX tree
 * compiles to them through `h`. An element is plain data — `{ type, props, children }` — and the
 * closures a control carries (`onPress`, `onInput`, `onSubmit`, `onSelect`) stay with the mod:
 * `serializeTree` lifts them into a table by the control's `key`, so the drawing a host sends to a
 * screen is JSON and a press comes back as `{ key }`.
 */

export const ELEMENT_NAMES = [
  'Box',
  'Text',
  'Button',
  'Link',
  'Code',
  'Markdown',
  'Input',
  'Select',
] as const
export type ElementName = (typeof ELEMENT_NAMES)[number]

export type RenderChild = RenderElement | string | number | boolean | null | undefined
export interface RenderElement {
  readonly type: ElementName | 'Fragment'
  readonly props: Readonly<Record<string, unknown>>
  readonly children: readonly RenderChild[]
}

export type ElementConstructor = (props?: Record<string, unknown>) => RenderElement
export type ElementTable = Record<ElementName, ElementConstructor>

function element(type: RenderElement['type'], props: Record<string, unknown> = {}): RenderElement {
  const { children, ...rest } = props
  const list = children === undefined ? [] : Array.isArray(children) ? children : [children]
  return Object.freeze({ type, props: Object.freeze(rest), children: Object.freeze(list.flat()) })
}

/** The constructor table `$.ui.resolve(e)` returns. */
export function elementTable(): ElementTable {
  return Object.fromEntries(
    ELEMENT_NAMES.map((name) => [name, (props?: Record<string, unknown>) => element(name, props)]),
  ) as ElementTable
}

export const Fragment = 'Fragment'

/** The JSX factory a hooks module's TSX compiles to: a function tag is called with its props. */
export function h(
  tag: ElementConstructor | typeof Fragment | ((props: Record<string, unknown>) => RenderElement),
  props: Record<string, unknown> | null,
  ...children: RenderChild[]
): RenderElement {
  const withChildren = { ...props, ...(children.length ? { children } : {}) }
  if (tag === Fragment) return element('Fragment', withChildren)
  return tag(withChildren)
}

/** A control's closures, by its `key`. */
export interface ElementHandlers {
  onPress?: () => unknown
  onInput?: (value: string) => unknown
  onSubmit?: (value: string) => unknown
  onSelect?: (value: string) => unknown
}

export interface JsonElement {
  type: ElementName
  props: Record<string, unknown>
  children: Array<JsonElement | string>
}

const HANDLERS = ['onPress', 'onInput', 'onSubmit', 'onSelect'] as const
const CONTROLS = new Set<string>(['Button', 'Input', 'Select'])
/** Text drawn from one tree, as Claude Code caps it. */
const MAX_TREE_TEXT = 100_000

export class InvalidTreeError extends Error {}

/**
 * A drawing as JSON plus its controls' closures. Fragments flatten; `null`, `undefined` and
 * booleans draw nothing. A control without a `key`, two controls on one key, an unknown element
 * or text past the cap is refused: the host then draws its own version of the site.
 */
export function serializeTree(tree: RenderChild): {
  tree: Array<JsonElement | string>
  handlers: Map<string, ElementHandlers>
} {
  const handlers = new Map<string, ElementHandlers>()
  let text = 0
  const visit = (child: RenderChild): Array<JsonElement | string> => {
    if (child === null || child === undefined || typeof child === 'boolean') return []
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child).length
      if (text > MAX_TREE_TEXT) throw new InvalidTreeError('the drawing has too much text')
      return [String(child)]
    }
    if (typeof child !== 'object' || !('type' in child))
      throw new InvalidTreeError('a child is not an element')
    const children = child.children.flatMap(visit)
    if (child.type === 'Fragment') return children
    if (!(ELEMENT_NAMES as readonly string[]).includes(child.type))
      throw new InvalidTreeError(`unknown element ${String(child.type)}`)
    const props: Record<string, unknown> = {}
    const own: ElementHandlers = {}
    for (const [name, value] of Object.entries(child.props)) {
      if ((HANDLERS as readonly string[]).includes(name) && typeof value === 'function')
        own[name as keyof ElementHandlers] = value as () => unknown
      else if (typeof value !== 'function') props[name] = value
    }
    if (CONTROLS.has(child.type)) {
      const key = props.key
      if (typeof key !== 'string' || !key) throw new InvalidTreeError(`a ${child.type} has no key`)
      if (handlers.has(key)) throw new InvalidTreeError(`two controls share the key "${key}"`)
      handlers.set(key, own)
    }
    return [{ type: child.type as ElementName, props, children }]
  }
  return { tree: visit(tree), handlers }
}

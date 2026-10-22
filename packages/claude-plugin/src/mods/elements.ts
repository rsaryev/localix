import { plainDataProblem } from './plain-data'

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
  // The desktop surface's own: an SVG drawing.
  'Svg',
  // A region one of the plugin's surface modules draws (`client-modules.ts` in the host).
  'Client',
] as const
export type ElementName = (typeof ELEMENT_NAMES)[number]

/**
 * What a surface module draws with (`surface.elements`): the terminal's table less `Client` (none
 * nests), `Raster` and `Image` — the controls keep their handlers in the module.
 */
export const CLIENT_ELEMENT_NAMES = [
  'Box',
  'Text',
  'Button',
  'Input',
  'Select',
  'Link',
  'Code',
  'Markdown',
] as const satisfies readonly ElementName[]

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
  /** A `Client`'s surface module as the host built it: a new revision is new code. */
  client?: { revision: string }
}

export interface SerializeOptions {
  /**
   * The revision of the plugin's surface module at `module` (its path under the plugin, as the
   * host rewrote it at load), or undefined when the host read no such module off the source.
   */
  client?: (module: string) => string | undefined
}

const HANDLERS = ['onPress', 'onInput', 'onSubmit', 'onSelect'] as const
const CONTROLS = new Set<string>(['Button', 'Input', 'Select'])
/** Text drawn from one tree, as Claude Code caps it. */
const MAX_TREE_TEXT = 100_000
/** An `Svg`'s markup, as Claude Code caps it. */
const MAX_SVG_SOURCE = 131_072
/** Elements in one tree and how deep they nest, as Claude Code bounds every tree. */
const MAX_TREE_NODES = 20_000
const MAX_TREE_DEPTH = 32
/** A `Client`'s `module`, as Claude Code caps it. */
const MAX_CLIENT_MODULE = 10_000
const CLIENT_PROPS = ['key', 'module', 'props', 'width', 'height', 'flexGrow'] as const

export class InvalidTreeError extends Error {}

/**
 * A drawing as JSON plus its controls' closures and its `Client`s' modules, by key. Fragments
 * flatten; `null`, `undefined` and booleans draw nothing. A control without a `key`, two controls
 * on one key, an unknown element, a `Client` whose module the host did not read at load, or a tree
 * past its bounds is refused: the host then draws its own version of the site.
 */
export function serializeTree(
  tree: RenderChild,
  options: SerializeOptions = {},
): {
  tree: Array<JsonElement | string>
  handlers: Map<string, ElementHandlers>
  clients: Map<string, string>
} {
  const handlers = new Map<string, ElementHandlers>()
  const clients = new Map<string, string>()
  let text = 0
  let nodes = 0
  const visit = (child: RenderChild, depth: number): Array<JsonElement | string> => {
    if (child === null || child === undefined || typeof child === 'boolean') return []
    if (++nodes > MAX_TREE_NODES) throw new InvalidTreeError('the drawing has too many elements')
    if (depth > MAX_TREE_DEPTH) throw new InvalidTreeError('the drawing nests too deep')
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child).length
      if (text > MAX_TREE_TEXT) throw new InvalidTreeError('the drawing has too much text')
      return [String(child)]
    }
    if (typeof child !== 'object' || !('type' in child))
      throw new InvalidTreeError('a child is not an element')
    const children = child.children.flatMap((next) => visit(next, depth + 1))
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
    if (child.type === 'Svg') {
      if (typeof props.source !== 'string' || !/^\s*<svg[\s/>]/i.test(props.source))
        throw new InvalidTreeError('an Svg takes its <svg> markup as source')
      if (props.source.length > MAX_SVG_SOURCE) throw new InvalidTreeError('an Svg is too large')
      if (typeof props.alt !== 'string') throw new InvalidTreeError('an Svg needs its alt text')
    }
    if (child.type === 'Client') return [clientOf(props, children.length, options, clients)]
    if (CONTROLS.has(child.type)) {
      const key = props.key
      if (typeof key !== 'string' || !key) throw new InvalidTreeError(`a ${child.type} has no key`)
      if (handlers.has(key)) throw new InvalidTreeError(`two controls share the key "${key}"`)
      handlers.set(key, own)
    }
    return [{ type: child.type as ElementName, props, children }]
  }
  return { tree: visit(tree, 1), handlers, clients }
}

const isPercent = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)

/** A `Client` as JSON: its own props, its module checked against what the host read at load. */
function clientOf(
  props: Record<string, unknown>,
  children: number,
  options: SerializeOptions,
  clients: Map<string, string>,
): JsonElement {
  const { key, module } = props
  if (typeof key !== 'string' || !key) throw new InvalidTreeError('a Client has no key')
  if (clients.has(key)) throw new InvalidTreeError(`two Clients share the key "${key}"`)
  if (typeof module !== 'string' || !module || module.length > MAX_CLIENT_MODULE)
    throw new InvalidTreeError('a Client names its surface module as module')
  if (children > 0) throw new InvalidTreeError('a Client takes no children')
  for (const name of ['width', 'height'] as const) {
    const size = props[name]
    if (size !== undefined && !(typeof size === 'number' && size >= 0) && !isPercent(size))
      throw new InvalidTreeError(`a Client's ${name} is a count or a percentage`)
  }
  if (props.flexGrow !== undefined && typeof props.flexGrow !== 'number')
    throw new InvalidTreeError("a Client's flexGrow is a number")
  const revision = options.client?.(module)
  if (revision === undefined)
    throw new InvalidTreeError(`a Client's module ${module} was not read off the source at load`)
  const problem = props.props === undefined ? null : plainDataProblem(props.props)
  if (problem) throw new InvalidTreeError(`a Client's props are not plain data: ${problem}`)
  clients.set(key, module)
  const own = Object.fromEntries(
    CLIENT_PROPS.filter((name) => props[name] !== undefined).map((name) => [name, props[name]]),
  )
  return { type: 'Client', props: own, children: [], client: { revision } }
}

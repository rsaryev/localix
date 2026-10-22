import {
  ELEMENT_NAMES,
  elementConstructor,
  elementNameOf,
  type ElementName,
} from '@localixai/claude-plugin/mods'

/**
 * How a value crosses between the mods host and a mod's worker. Messages are structured clones,
 * which carry no functions, so a function travels as a reference: the side that owns it keeps it
 * by id, and the other side gets a stand-in that calls it over the channel (`endpoint.ts`). A
 * stand-in sent back is its owner's own function again. An element constructor is pure, so it
 * travels by its element's name and is rebuilt where it lands; an error travels as its message.
 *
 * The worker runs a mod's code, so what it sends is untrusted. `encode` refuses a plain object or
 * array element that carries the reference key; a class instance or a `Map` is posted as it is,
 * and `decode` reads no reference inside one, so a key there is data. `decode` refuses a reference
 * of a shape `encode` never makes, and a value past its `limits`, as a `WireError` the receiving
 * side answers as the sender's failure, never a throw of its own. A reference of the right shape
 * is read as such: it can name only the other side's own functions, or the functions this side
 * lent it (an id this side never lent answers "released").
 */

/** The key a reference is wrapped in; a value that uses it is refused (`WireError`). */
const REF = '\u0000lx'

/** A value the channel does not carry, or a message the other side could not have sent. */
export class WireError extends Error {
  override name = 'WireError'
}

type Wired =
  | { fn: number }
  | { own: number }
  | { element: ElementName }
  | { error: { name: string; message: string } }

/** The functions one side of the channel keeps and the stand-ins it holds for the other's. */
export interface WireTable {
  /** The id the other side calls this side's `fn` by. */
  keep(fn: (...args: unknown[]) => unknown): number
  /** The other side's id when `fn` is a stand-in for one of its functions. */
  idOfStandIn(fn: unknown): number | undefined
  /** A function that calls the other side's function `id`. */
  standIn(id: number): (...args: unknown[]) => unknown
  /** This side's function the other side named. */
  kept(id: number): (...args: unknown[]) => unknown
}

/** Deeper than any drawing or event a mod sends; a cycle stops here. */
const MAX_DEPTH = 64

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** `value` with its functions and errors as references, ready to post. */
export function encode(value: unknown, table: WireTable, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new WireError('a value sent to or from a mod nests too deep')
  if (typeof value === 'function') {
    const element = elementNameOf(value)
    if (element) return wired({ element })
    const own = table.idOfStandIn(value)
    if (own !== undefined) return wired({ own })
    return wired({ fn: table.keep(value as (...args: unknown[]) => unknown) })
  }
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Error) return wired({ error: { name: value.name, message: value.message } })
  if (Array.isArray(value)) return value.map((item) => encode(item, table, depth + 1))
  if (!isPlainObject(value)) return value
  if (Object.hasOwn(value, REF))
    throw new WireError('a value sent to or from a mod uses a reserved key')
  const copy: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value))
    assign(copy, key, encode(field, table, depth + 1))
  return copy
}

const wired = (ref: Wired) => ({ [REF]: ref })

/** `copy[key] = field`, with a `__proto__` key kept as data rather than setting the prototype. */
function assign(copy: Record<string, unknown>, key: string, field: unknown) {
  if (key === '__proto__')
    Object.defineProperty(copy, key, {
      value: field,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  else copy[key] = field
}

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0

const isElementName = (name: unknown): name is ElementName =>
  typeof name === 'string' && (ELEMENT_NAMES as readonly string[]).includes(name)

/** `wrapper` as the reference `encode` makes, or a `WireError`: a forgery is not trusted. */
function readRef(wrapper: object): Wired {
  const ref = (wrapper as Record<string, unknown>)[REF]
  const malformed = () => new WireError('a value from the other side carries a malformed reference')
  if (Object.keys(wrapper).length !== 1 || ref === null || typeof ref !== 'object')
    throw malformed()
  if (!isPlainObject(ref) || Object.keys(ref).length !== 1) throw malformed()
  const fields = ref as Record<string, unknown>
  if ('fn' in fields && isId(fields.fn)) return { fn: fields.fn }
  if ('own' in fields && isId(fields.own)) return { own: fields.own }
  if ('element' in fields && isElementName(fields.element)) return { element: fields.element }
  const error = fields.error as Record<string, unknown> | null | undefined
  if (
    'error' in fields &&
    typeof error === 'object' &&
    error !== null &&
    typeof error.name === 'string' &&
    typeof error.message === 'string'
  )
    return { error: { name: error.name, message: error.message } }
  throw malformed()
}

/** How much one decoded value may hold: values counted, and nesting. */
export interface WireLimits {
  values: number
  depth: number
}

const UNLIMITED: WireLimits = { values: Infinity, depth: MAX_DEPTH }

/**
 * What `encode` sent, with each reference turned back into a function or an error. Throws a
 * `WireError` for a reference `encode` would not have made, or a value past `limits`.
 */
export function decode(value: unknown, table: WireTable, limits: WireLimits = UNLIMITED): unknown {
  let values = 0
  const visit = (item: unknown, depth: number): unknown => {
    if (++values > limits.values)
      throw new WireError(`a value sent by a mod holds more than ${limits.values} values`)
    if (item === null || typeof item !== 'object') return item
    if (depth > Math.min(limits.depth, MAX_DEPTH))
      throw new WireError('a value sent to or from a mod nests too deep')
    if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1))
    if (!isPlainObject(item)) return item
    if (Object.hasOwn(item, REF)) {
      const ref = readRef(item)
      if ('fn' in ref) return table.standIn(ref.fn)
      if ('own' in ref) return table.kept(ref.own)
      if ('element' in ref) return elementConstructor(ref.element)
      return Object.assign(new Error(ref.error.message), { name: ref.error.name })
    }
    const copy: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(item)) assign(copy, key, visit(field, depth + 1))
    return copy
  }
  return visit(value, 0)
}

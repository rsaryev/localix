/**
 * The values JSON does not carry, as the channel to a mod's VM carries them (`wire.ts`): what a
 * structured clone kept — `undefined`, `NaN` and the infinities, a `bigint`, a `Date`, a `Map`, a
 * `Set`, bytes — becomes a tagged value, and comes back as itself. Each side runs this file: the
 * host, and the mod's VM, where it is bundled into the runtime (`guest/`). What arrives is not
 * trusted: a tag of a shape `tag` never makes is refused.
 */

/** The typed arrays bytes travel as, by name; every runtime the channel joins has each of them. */
const BYTE_KINDS = [
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
] as const
type ByteKind = (typeof BYTE_KINDS)[number]

export type DataTag =
  | { undefined: true }
  | { number: 'NaN' | 'Infinity' | '-Infinity' }
  | { bigint: string }
  | { date: number | null }
  | { bytes: [ByteKind, string] }
  | { map: unknown[] }
  | { set: unknown[] }

/** Bytes per `fromCharCode` call: its arguments sit on the stack, which a VM keeps small. */
const CHUNK = 0x1000

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const kindOf = (value: object): ByteKind | undefined => {
  if (value instanceof ArrayBuffer) return 'ArrayBuffer'
  if (!ArrayBuffer.isView(value)) return undefined
  const name = Object.getPrototypeOf(value)?.constructor?.name as string | undefined
  return (BYTE_KINDS as readonly string[]).includes(name ?? '') ? (name as ByteKind) : undefined
}

/**
 * `value` as a tag, with `inner` encoding what a `Map` or `Set` holds; undefined when it is a value
 * JSON carries as it is (or an object the caller copies field by field).
 */
export function tag(value: unknown, inner: (item: unknown) => unknown): DataTag | undefined {
  if (value === undefined) return { undefined: true }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return undefined
    return { number: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' }
  }
  if (typeof value === 'bigint') return { bigint: value.toString() }
  if (value === null || typeof value !== 'object') return undefined
  if (value instanceof Date) {
    const time = value.getTime()
    return { date: Number.isNaN(time) ? null : time }
  }
  if (value instanceof Map)
    return { map: [...value].map(([key, item]) => [inner(key), inner(item)]) }
  if (value instanceof Set) return { set: [...value].map(inner) }
  const kind = kindOf(value)
  if (!kind) return undefined
  const view =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(
          (value as ArrayBufferView).buffer,
          (value as ArrayBufferView).byteOffset,
          (value as ArrayBufferView).byteLength,
        )
  return { bytes: [kind, toBase64(view)] }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * What `fields` (a tag's own fields) stands for, with `inner` decoding what a `Map` or `Set`
 * holds; `malformed` when it is no tag `tag` makes.
 */
export function untag(
  fields: Record<string, unknown>,
  inner: (item: unknown) => unknown,
  malformed: () => Error,
): unknown {
  const [key] = Object.keys(fields)
  const field = fields[key!]
  switch (key) {
    case 'undefined':
      if (field === true) return undefined
      break
    case 'number':
      if (field === 'NaN') return Number.NaN
      if (field === 'Infinity') return Infinity
      if (field === '-Infinity') return -Infinity
      break
    case 'bigint':
      if (typeof field === 'string' && /^-?\d{1,4096}$/.test(field)) return BigInt(field)
      break
    case 'date':
      if (field === null || (typeof field === 'number' && Number.isFinite(field)))
        return new Date(field ?? Number.NaN)
      break
    case 'map':
      if (Array.isArray(field) && field.every((pair) => Array.isArray(pair) && pair.length === 2))
        return new Map(field.map(([one, two]: unknown[]) => [inner(one), inner(two)]))
      break
    case 'set':
      if (Array.isArray(field)) return new Set(field.map(inner))
      break
    case 'bytes':
      if (Array.isArray(field) && field.length === 2) {
        const bytes = bytesOf(field[0], field[1])
        if (bytes) return bytes
      }
      break
  }
  throw malformed()
}

/** The bytes `text` holds as a `kind`, or undefined when either is not what `tag` makes. */
function bytesOf(kind: unknown, text: unknown): object | undefined {
  const known = (BYTE_KINDS as readonly unknown[]).includes(kind)
  if (!known || typeof text !== 'string' || text.length % 4 !== 0 || !BASE64.test(text)) return
  const bytes = fromBase64(text)
  if (kind === 'ArrayBuffer') return bytes.buffer
  if (kind === 'DataView') return new DataView(bytes.buffer)
  const View = globalThis[kind as Exclude<ByteKind, 'ArrayBuffer' | 'DataView'>]
  if (bytes.byteLength % View.BYTES_PER_ELEMENT !== 0) return
  return Reflect.construct(View, [bytes.buffer]) as object
}

/** The keys a tag of `untag`'s is under: one of these, and nothing else. */
export const TAG_KEYS: ReadonlySet<string> = new Set([
  'undefined',
  'number',
  'bigint',
  'date',
  'map',
  'set',
  'bytes',
])

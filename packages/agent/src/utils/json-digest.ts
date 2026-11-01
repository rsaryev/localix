import { textEncoderByteLength } from './hash'

/**
 * A digest of a large JSON tool result: what the model reads instead of 200KB of it.
 *
 * Pure and storage-free. The host decides WHEN a result is too big, saves `file` somewhere
 * readable, and calls `render(path)` so the digest can name it. The digest holds the size, the
 * shape (keys, value types, every array's length, one item shape merged from the first items),
 * a bounded preview, and every error-like field whole up to a budget, so shrinking a result never
 * hides why it failed.
 */

const SHAPE_BYTES = 4 * 1024
const PREVIEW_BYTES = 4 * 1024
const ERROR_BYTES = 8 * 1024
/** Room reserved for the envelope text and a path, when judging whether a digest saves anything. */
const ENVELOPE_BYTES = 768
const SAMPLE_ITEMS = 20
const MAX_FIELDS = 40
const MAX_ERROR_FIELDS = 20
const ERROR_KEY = /error|stack|stderr|exception|message|reason/iu

type Shape =
  | string
  | { array: number; items?: Shape }
  | { fields: Record<string, Shape>; more?: number }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const scalarType = (v: unknown): string => (v === null ? 'null' : typeof v)

/** Two shapes seen at the same place, as one. Unlike structures collapse to `mixed`. */
function merge(a: Shape, b: Shape): Shape {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b ? a : [...new Set([...a.split('|'), ...b.split('|')])].sort().join('|')
  }
  if (typeof a === 'string' || typeof b === 'string') return 'mixed'
  if ('array' in a && 'array' in b) {
    const items = a.items && b.items ? merge(a.items, b.items) : (a.items ?? b.items)
    return { array: Math.max(a.array, b.array), ...(items ? { items } : {}) }
  }
  if ('fields' in a && 'fields' in b) {
    const fields = { ...a.fields }
    let more = (a.more ?? 0) + (b.more ?? 0)
    for (const [key, shape] of Object.entries(b.fields)) {
      if (key in fields) fields[key] = merge(fields[key]!, shape)
      else if (Object.keys(fields).length < MAX_FIELDS) fields[key] = shape
      else more += 1
    }
    return { fields, ...(more > 0 ? { more } : {}) }
  }
  return 'mixed'
}

function shapeOf(value: unknown, depth: number): Shape {
  if (Array.isArray(value)) {
    if (depth <= 0) return { array: value.length }
    const items = value
      .slice(0, SAMPLE_ITEMS)
      .map((item) => shapeOf(item, depth - 1))
      .reduce<Shape | undefined>((acc, s) => (acc === undefined ? s : merge(acc, s)), undefined)
    return { array: value.length, ...(items === undefined ? {} : { items }) }
  }
  if (!isRecord(value)) return scalarType(value)
  const keys = Object.keys(value)
  if (depth <= 0) return { fields: {}, more: keys.length }
  const fields: Record<string, Shape> = {}
  for (const key of keys.slice(0, MAX_FIELDS)) fields[key] = shapeOf(value[key], depth - 1)
  return { fields, ...(keys.length > MAX_FIELDS ? { more: keys.length - MAX_FIELDS } : {}) }
}

const size = (v: unknown): number => textEncoderByteLength(JSON.stringify(v))

/** The deepest shape that fits its budget. */
function boundedShape(value: unknown): Shape {
  for (const depth of [6, 4, 3, 2]) {
    const shape = shapeOf(value, depth)
    if (size(shape) <= SHAPE_BYTES) return shape
  }
  return shapeOf(value, 0)
}

/** A copy with arrays cut to `items`, strings to `chars`, and a note wherever something was cut. */
function pruned(value: unknown, items: number, chars: number, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length <= chars
      ? value
      : `${value.slice(0, chars)}…[+${value.length - chars} chars]`
  }
  if (depth >= 8 && typeof value === 'object' && value !== null) return '…'
  if (Array.isArray(value)) {
    const kept = value.slice(0, items).map((v) => pruned(v, items, chars, depth + 1))
    return value.length > items ? [...kept, `…${value.length - items} more items`] : kept
  }
  if (!isRecord(value)) return value
  const keys = Object.keys(value)
  const copy: Record<string, unknown> = {}
  for (const key of keys.slice(0, MAX_FIELDS))
    copy[key] = pruned(value[key], items, chars, depth + 1)
  if (keys.length > MAX_FIELDS) copy['…'] = `${keys.length - MAX_FIELDS} more fields`
  return copy
}

function previewOf(value: unknown): unknown {
  for (const [items, chars] of [
    [5, 300],
    [3, 120],
    [1, 60],
  ] as const) {
    const preview = pruned(value, items, chars)
    if (size(preview) <= PREVIEW_BYTES) return preview
  }
  return pruned(value, 1, 20, 6)
}

/** Error-like fields (and where they sit), each whole while the budget lasts; never more than a few. */
function errorFields(value: unknown): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = []
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 5) return
    if (Array.isArray(v)) {
      v.slice(0, SAMPLE_ITEMS).forEach((item, i) => visit(item, `${path}[${i}]`, depth + 1))
    } else if (isRecord(v)) {
      for (const [key, field] of Object.entries(v)) {
        const at = path === '' ? key : `${path}.${key}`
        const present = field !== null && field !== undefined && field !== ''
        if (present && ERROR_KEY.test(key) && typeof field !== 'object')
          found.push({ path: at, text: String(field) })
        else if (present && ERROR_KEY.test(key))
          found.push({ path: at, text: JSON.stringify(field) })
        else visit(field, at, depth + 1)
      }
    }
  }
  visit(value, '', 0)
  let room = ERROR_BYTES
  const kept: { path: string; text: string }[] = []
  for (const entry of found.slice(0, MAX_ERROR_FIELDS)) {
    room -= entry.path.length
    if (room <= 0) break
    const text = entry.text.length <= room ? entry.text : `${entry.text.slice(0, room)}…[cut]`
    room -= text.length
    kept.push({ path: entry.path, text })
  }
  return kept
}

export interface JsonDigest {
  /** The whole value, indented one entry per line so `grep` prints a match, not the result. */
  file: string
  /** The model-facing digest text, naming where `file` was saved. */
  render(path: string): string
}

/**
 * Digest `text` when it is a JSON object or array and the digest is clearly smaller than it.
 * Anything else (plain text, a bare scalar, a result too small to shrink) returns undefined and
 * the caller keeps the text as it is.
 */
export function jsonDigest(text: string): JsonDigest | undefined {
  const lead = text.trimStart()[0]
  if (lead !== '{' && lead !== '[') return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  const bytes = textEncoderByteLength(text)
  const errors = errorFields(value)
  const body = {
    shape: boundedShape(value),
    preview: previewOf(value),
    ...(errors.length > 0 ? { errors } : {}),
  }
  if (size(body) + ENVELOPE_BYTES >= bytes) return undefined
  return {
    file: `${JSON.stringify(value, null, 2)}\n`,
    render: (path) =>
      JSON.stringify({
        kind: 'json_digest',
        bytes,
        path,
        note: `This result is ${bytes} bytes of JSON, so this is its digest: shape with every array's length, the first items, and error fields kept whole. The full result is in ${path}; read it (offset/limit) or grep -n it before relying on what the digest leaves out.`,
        ...body,
      }),
  }
}

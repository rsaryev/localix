/**
 * Pure MongoDB helpers — the testable kernel of the Mongo driver (a thin
 * `mongodb` wrapper around these). Parses the console's `db.<collection>.<method>(<args>)`
 * shell-style input into a structured call, and shapes a query result (array of documents,
 * a scalar, or a distinct list) into the SQL-shaped {@link DbResultSet} the grid renders.
 *
 * Argument parsing is strict Extended JSON (double-quoted keys) with small ObjectId()/Date()
 * shell conveniences. BSON-only input and result values stay typed end-to-end.
 */
import { BSON } from 'mongodb'
import type { DbResultSet } from './port'
import { exactJsonInteger, stringifyJsonExact } from '../../shared/exact-json'

/** Read methods the console understands (mapped to the driver's collection calls). */
export const MONGO_METHODS = [
  'find',
  'findOne',
  'aggregate',
  'countDocuments',
  'count',
  'distinct',
] as const
export type MongoMethod = (typeof MONGO_METHODS)[number]

export interface MongoCommand {
  collection: string
  method: MongoMethod
  /** Parsed JSON arguments, in order (e.g. find → [filter, projection]). */
  args: unknown[]
}

const CALL_RE = /^(?:db\.)?([A-Za-z0-9_$.-]+)\.([A-Za-z]+)\s*\(([\s\S]*)\)\s*;?\s*$/

function requireDocument(value: unknown, label: string, nullable = false): void {
  if ((nullable && value === null) || isPlainObject(value)) return
  throw new Error(`${label} must be a JSON object${nullable ? ' or null' : ''}`)
}

function validateArgs(method: MongoMethod, args: unknown[]): void {
  switch (method) {
    case 'find':
    case 'findOne': {
      if (args.length > 3) throw new Error(`.${method}() accepts at most three arguments`)
      if (args[0] !== undefined) requireDocument(args[0], `${method} filter`)
      if (args[1] !== undefined) requireDocument(args[1], `${method} projection`, true)
      if (args[2] !== undefined) {
        requireDocument(args[2], `${method} options`)
        const limit = (args[2] as Record<string, unknown>).limit
        if (
          method === 'find' &&
          limit !== undefined &&
          (typeof limit !== 'number' || !Number.isSafeInteger(limit))
        ) {
          throw new Error('find options.limit must be a safe integer')
        }
      }
      break
    }
    case 'aggregate':
      if (args.length > 2) throw new Error('.aggregate() accepts at most two arguments')
      if (args[0] !== undefined) {
        if (!Array.isArray(args[0]) || !args[0].every(isPlainObject)) {
          throw new Error('aggregate pipeline must be an array of JSON objects')
        }
      }
      if (args[1] !== undefined) requireDocument(args[1], 'aggregate options')
      break
    case 'count':
    case 'countDocuments':
      if (args.length > 2) throw new Error(`.${method}() accepts at most two arguments`)
      if (args[0] !== undefined) requireDocument(args[0], `${method} filter`)
      if (args[1] !== undefined) requireDocument(args[1], `${method} options`)
      break
    case 'distinct':
      if (args.length < 1 || args.length > 3 || typeof args[0] !== 'string' || !args[0]) {
        throw new Error('.distinct() requires a non-empty field string and at most two objects')
      }
      if (args[1] !== undefined) requireDocument(args[1], 'distinct filter')
      if (args[2] !== undefined) requireDocument(args[2], 'distinct options')
      break
  }
}

/**
 * Rewrite the most common Mongo-shell constructors into MongoDB Extended JSON so the strict
 * JSON parser accepts them — `ObjectId("…")`→`{"$oid":"…"}`, `ISODate("…")`/`new Date("…")`→
 * `{"$date":"…"}`. The driver revives these sentinels into real ObjectId/Date before querying.
 * (Keys still need double quotes — this covers the values that block real queries by _id/date.)
 */
export function desugarMongo(text: string): string {
  return text
    .replace(/ObjectId\(\s*(['"])([0-9a-fA-F]{24})\1\s*\)/g, '{"$$oid":"$2"}')
    .replace(/(?:new\s+Date|ISODate)\(\s*(['"])([^'"]*)\1\s*\)/g, '{"$$date":"$2"}')
}

/**
 * Split a top-level argument list on commas, respecting nested {}/[] and quoted strings, so
 * `{"a":1}, {"b":0}` → ['{"a":1}', '{"b":0}']. Returns [] for an empty/whitespace list.
 */
export function splitTopLevelArgs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts: string[] = []
  let depth = 0
  let inStr: '"' | "'" | null = null
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (inStr) {
      cur += ch
      if (ch === '\\' && i + 1 < trimmed.length) {
        cur += trimmed[++i]
      } else if (ch === inStr) {
        inStr = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch
      cur += ch
    } else if (ch === '{' || ch === '[') {
      depth++
      cur += ch
    } else if (ch === '}' || ch === ']') {
      depth--
      cur += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/**
 * Parse a `db.<collection>.<method>(<json-args>)` command. Throws a friendly Error on a
 * malformed call, an unsupported method, or invalid JSON arguments.
 */
export function parseMongoCommand(input: string): MongoCommand {
  const m = CALL_RE.exec(input.trim())
  if (!m) {
    throw new Error(
      'Expected db.<collection>.<method>(<args>) — e.g. db.users.find({"age":{"$gt":20}})',
    )
  }
  const [, collection, methodRaw, argsText] = m
  const method = methodRaw as MongoMethod
  if (!MONGO_METHODS.includes(method)) {
    throw new Error(`Unsupported method ".${methodRaw}()". Supported: ${MONGO_METHODS.join(', ')}`)
  }
  const args = splitTopLevelArgs(desugarMongo(argsText!)).map((piece, i) => {
    try {
      // Relaxed mode keeps ordinary JSON numbers ergonomic while useBigInt64 preserves
      // canonical `$numberLong` exactly. Other EJSON wrappers revive Decimal128, Binary,
      // ObjectId, Date, UUID, regex, timestamps, MinKey/MaxKey, and Code.
      return BSON.EJSON.parse(piece, { relaxed: true, useBigInt64: true })
    } catch {
      throw new Error(`Argument ${i + 1} isn't valid JSON: ${piece}`)
    }
  })
  validateArgs(method, args)
  return { collection: collection!, method, args }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const prototype = Object.getPrototypeOf(v)
  return prototype === Object.prototype || prototype === null
}

/**
 * Canonical EJSON preserves BSON identity but wraps every ordinary number. Collapse safe
 * numeric wrappers back to the grid's normal number/string convention while retaining the
 * wrappers that carry real type information (`$oid`, `$binary`, `$numberDecimal`, dates, …).
 */
function readableCanonicalEjson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(readableCanonicalEjson)
  if (!isPlainObject(value)) return value

  const keys = Object.keys(value)
  if (keys.length === 1) {
    const integer = value.$numberInt ?? value.$numberLong
    if (typeof integer === 'string' && /^-?\d+$/.test(integer)) {
      return exactJsonInteger(BigInt(integer))
    }
    if (typeof value.$numberDouble === 'string') {
      const number = Number(value.$numberDouble)
      // NaN/Infinity and negative zero need their EJSON wrapper to survive JSON transport.
      if (Number.isFinite(number) && !Object.is(number, -0)) return number
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, readableCanonicalEjson(nested)]),
  )
}

/** Render one document field into a cell (scalars as-is, nested object/array as compact JSON). */
function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return exactJsonInteger(v)
  if (['string', 'number', 'boolean'].includes(typeof v)) return v
  try {
    const canonical = BSON.EJSON.serialize(v, { relaxed: false })
    const readable = readableCanonicalEjson(canonical)
    if (readable === null || ['string', 'number', 'boolean'].includes(typeof readable)) {
      return readable
    }
    return stringifyJsonExact(readable)
  } catch {
    return '[unserializable]'
  }
}

/**
 * Shape a Mongo query result into the grid's {@link DbResultSet}:
 * - an array of documents → columns = union of top-level keys (`_id` first), a row per doc;
 * - an array of scalars (distinct) → a single `value` column;
 * - a lone document → its keys as columns, one row;
 * - a scalar (count) → one `value` cell.
 */
export function shapeMongoResult(result: unknown, durationMs = 0): DbResultSet {
  if (Array.isArray(result)) {
    if (result.length === 0) return { columns: [{ name: '_id' }], rows: [], durationMs }
    if (result.every((r) => !isPlainObject(r))) {
      return { columns: [{ name: 'value' }], rows: result.map((v) => [cell(v)]), durationMs }
    }
    // Union of keys across docs, preserving first-seen order, with `_id` pinned first.
    const keys: string[] = []
    const seen = new Set<string>()
    for (const doc of result) {
      if (!isPlainObject(doc)) continue
      for (const k of Object.keys(doc)) {
        if (!seen.has(k)) {
          seen.add(k)
          keys.push(k)
        }
      }
    }
    keys.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
    return {
      columns: keys.map((name) => ({ name })),
      rows: result.map((doc) => keys.map((k) => cell(isPlainObject(doc) ? doc[k] : undefined))),
      durationMs,
    }
  }
  if (isPlainObject(result)) {
    const keys = Object.keys(result)
    return {
      columns: keys.map((name) => ({ name })),
      rows: [keys.map((k) => cell(result[k]))],
      durationMs,
    }
  }
  return { columns: [{ name: 'value' }], rows: [[cell(result)]], durationMs }
}

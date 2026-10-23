/**
 * Pure, dependency-free Elasticsearch helpers — the testable kernel of the ES driver. Parses
 * the search console's `<index>.<method>(<json-args>)` input (mirroring the Mongo console) and
 * flattens an ES response into the SQL-shaped {@link DbResultSet} the grid renders.
 *
 * Reuses the generic argument splitter + document shaper from the Mongo kernel (both are
 * engine-agnostic pure helpers) so a search hit list renders exactly like a document list.
 */
import type { DbResultSet } from './port'
import { shapeMongoResult, splitTopLevelArgs } from './mongo-query'
import { parseEsJsonExact } from './es-serializer'
import { defineRecordValue } from '../../shared/safe-record'

/** Read methods the search console understands. */
export const ES_METHODS = ['search', 'count', 'get'] as const
export type EsMethod = (typeof ES_METHODS)[number]

export interface EsCommand {
  index: string
  method: EsMethod
  /** Parsed JSON arguments, in order (search → [body], get → [id]). */
  args: unknown[]
}

const CALL_RE = /^([A-Za-z0-9_*.-]+)\.([A-Za-z]+)\s*\(([\s\S]*)\)\s*;?\s*$/

function validateArgs(method: EsMethod, args: unknown[]): void {
  if (method === 'get') {
    if (args.length !== 1 || typeof args[0] !== 'string' || !args[0]) {
      throw new Error('.get() requires exactly one non-empty JSON string document id')
    }
    return
  }
  if (args.length > 1 || (args.length === 1 && !isObj(args[0]))) {
    throw new Error(`.${method}() accepts at most one JSON object`)
  }
}

/**
 * Parse an `<index>.<method>(<json-args>)` command (e.g. `products.search({"query":{"match_all":{}}})`).
 * Throws a friendly Error on a malformed call, an unsupported method, or invalid JSON args.
 */
export function parseEsCommand(input: string): EsCommand {
  const m = CALL_RE.exec(input.trim())
  if (!m) {
    throw new Error(
      'Expected <index>.<method>(<args>) — e.g. products.search({"query":{"match_all":{}}})',
    )
  }
  const [, index, methodRaw, argsText] = m
  const method = methodRaw as EsMethod
  if (!ES_METHODS.includes(method)) {
    throw new Error(`Unsupported method ".${methodRaw}()". Supported: ${ES_METHODS.join(', ')}`)
  }
  const args = splitTopLevelArgs(argsText).map((piece, i) => {
    try {
      return parseEsJsonExact(piece)
    } catch {
      throw new Error(`Argument ${i + 1} isn't valid JSON: ${piece}`)
    }
  })
  validateArgs(method, args)
  return { index: index!, method, args }
}

interface EsHit {
  _index?: string
  _id?: string
  _score?: number | null
  _source?: Record<string, unknown>
  fields?: Record<string, unknown>
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Merge user-supplied API parameters without letting a nested `index` contradict the
 *  `<index>.method(...)` command target. */
export function targetEsRequest(
  index: string,
  params: Record<string, unknown>,
): Record<string, unknown> & { index: string } {
  return { ...params, index }
}

function addCollisionSafe(
  document: Record<string, unknown>,
  key: string,
  value: unknown,
  namespace: '_source' | '_fields' | '_response',
): void {
  if (!Object.hasOwn(document, key)) {
    defineRecordValue(document, key, value)
    return
  }

  let alias = `${namespace}.${key}`
  let suffix = 2
  while (Object.hasOwn(document, alias)) {
    alias = `${namespace}${suffix}.${key}`
    suffix += 1
  }
  defineRecordValue(document, alias, value)
}

function hitDocument(hit: EsHit): Record<string, unknown> {
  // `_index` is essential for wildcard/alias searches where the same `_id` may occur in
  // several indices. Keep response metadata authoritative while retaining colliding user
  // fields under an explicit namespace instead of silently overwriting either value.
  const document: Record<string, unknown> = { _id: hit._id }
  if (Object.hasOwn(hit, '_index')) document._index = hit._index
  if (Object.hasOwn(hit, '_score')) document._score = hit._score ?? null
  const source = isObj(hit._source) ? hit._source : undefined
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      addCollisionSafe(document, key, value, '_source')
    }
  }
  if (isObj(hit.fields)) {
    for (const [key, value] of Object.entries(hit.fields)) {
      // The fields API commonly repeats mapped source fields in a normalized array form.
      // Prefer the original source value; fields still fill the grid when `_source:false`.
      if (source && Object.hasOwn(source, key)) continue
      addCollisionSafe(document, key, value, '_fields')
    }
  }
  return document
}

function searchPayload(result: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const sections = [
    ['aggregations', '_aggregations'],
    ['suggest', '_suggest'],
    ['profile', '_profile'],
  ] as const
  for (const [responseKey, column] of sections) {
    if (Object.hasOwn(result, responseKey) && result[responseKey] !== undefined) {
      payload[column] = result[responseKey]
    }
  }

  // Successful HTTP status does not guarantee a complete search response. Surface only
  // exceptional execution metadata; the common timed_out:false / failed:0 envelope would
  // otherwise add noise to every row.
  if (result.timed_out === true) payload._timed_out = true
  if (result.terminated_early === true) payload._terminated_early = true
  const shards = isObj(result._shards) ? result._shards : undefined
  if (shards && typeof shards.failed === 'number' && shards.failed > 0) {
    payload._shards = shards
  }
  return payload
}

/**
 * Flatten an ES response into the grid's {@link DbResultSet} via the generic doc shaper:
 * - a `_search` result (`hits.hits[]`) → one row per hit, columns = response metadata +
 *   `_source` keys (or requested `fields` when source is disabled);
 * - aggregations, suggestions, profiling data, and incomplete-result metadata → one payload
 *   on the first hit (or a standalone row when there are no hits);
 * - a `count` result → a single `count` value cell;
 * - a `get` result (`_source`) → the doc as one row;
 * - anything else → shaped as-is.
 */
export function shapeEsResult(result: unknown, durationMs = 0): DbResultSet {
  if (isObj(result)) {
    const hits = (result.hits as { hits?: EsHit[] } | undefined)?.hits
    if (Array.isArray(hits)) {
      const docs = hits.map(hitDocument)
      const payload = searchPayload(result)
      if (docs.length === 0 && Object.keys(payload).length > 0) {
        return shapeMongoResult(payload, durationMs)
      }
      if (docs.length > 0) {
        // Keep each response-level tree once instead of dropping it or duplicating a
        // potentially large payload on every matching document.
        for (const [key, value] of Object.entries(payload)) {
          addCollisionSafe(docs[0]!, key, value, '_response')
        }
      }
      return shapeMongoResult(docs, durationMs)
    }
    if (typeof result.count === 'number') {
      return shapeMongoResult({ count: result.count }, durationMs)
    }
    if (result._source !== undefined) {
      return shapeMongoResult(
        hitDocument({
          _index: typeof result._index === 'string' ? result._index : undefined,
          _id: typeof result._id === 'string' ? result._id : undefined,
          _source: isObj(result._source) ? result._source : undefined,
        }),
        durationMs,
      )
    }
  }
  return shapeMongoResult(result, durationMs)
}

/**
 * OpenAPI 3 → RequestSpecs. One pasted spec becomes every endpoint it documents.
 *
 * This is the bulk counterpart to the curl importer: curl is how you get ONE call you were shown,
 * a spec is how you get an API you were given. Together with the vault it means "here is our
 * OpenAPI doc" ends with a working, credential-referencing request per endpoint.
 *
 * Two compatibility rules are important:
 *
 *   - Legal OpenAPI version strings include `"3.1"` and `"3.0"`, so the gate accepts any 3.x.
 *   - `path` parameters are emitted with their documented examples as well as rewritten from `{id}`
 *     to the local `:id` placeholder grammar, so imported requests can be filled before sending.
 */

import { parse as parseYaml } from 'yaml'
import type { Pair, RequestBody, RequestSpec } from '../request-spec'
import { parseMethod } from '../request-spec'
import type { ImportedRequest, Importer, ImportOptions } from './types'
import { exampleFor, parameterValue } from './openapi/example'
import { resolveRef } from './openapi/pointer'
import { authForOperation } from './openapi/security'
import { baseUrlFrom } from './openapi/server'
import {
  isSpecExtension,
  OA_METHODS,
  type OADocument,
  type OAOperation,
  type OAParameter,
  type OARequestBody,
} from './openapi/types'

/**
 * The unsupported schemes found on the LAST conversion of a given payload.
 *
 * A cache keyed by the source text, because `Importer.notes(text)` is a second call over the same
 * payload and re-walking a large spec to recount is waste. Bounded to one entry: the chain converts
 * then immediately asks, so nothing older is ever wanted, and an unbounded map keyed by whole
 * documents is a leak.
 */
const unsupportedByDoc = new Map<string, string[]>()

/** Unsupported auth for `text`, converting first if this payload has not been seen. */
function collectUnsupportedAuth(text: string): string[] {
  if (!unsupportedByDoc.has(text)) convertOpenApi(text)
  const found = unsupportedByDoc.get(text) ?? []
  unsupportedByDoc.clear()
  return found
}

/** Any 3.x, including legal shortened versions such as `3.0` and `3.1`. */
const OPENAPI_3 = /^3\./

/** Parse JSON, then YAML. A spec is published as either, and YAML is a JSON superset anyway. */
export function parseDocument(text: string): OADocument | null {
  try {
    return JSON.parse(text) as OADocument
  } catch {
    // Not JSON — fall through. A YAML parse of non-YAML throws, which the caller treats as
    // "not my format".
  }
  try {
    const doc = parseYaml(text) as unknown
    return doc && typeof doc === 'object' ? (doc as OADocument) : null
  } catch {
    return null
  }
}

/** `/users/{id}` → `/users/:id`, our placeholder grammar. */
export function pathToPlaceholders(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

/** A short slug for the API, used to namespace the vault keys an import mints. */
function apiSlug(document: OADocument): string {
  const title = document.info?.title?.trim()
  if (title) return title
  try {
    return new URL(baseUrlFrom(document.servers)).hostname.split('.')[0]
  } catch {
    return 'api'
  }
}

/** A stable, readable name. `operationId` is the spec's OWN unique id — prefer it to a summary. */
export function operationName(path: string, method: string, operation: OAOperation): string {
  const raw = operation.operationId?.trim() || operation.summary?.trim() || `${method} ${path}`
  return (
    raw
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'request'
  )
}

/** The parameters that apply to an operation: the path item's, then its own (its own win). */
function mergeParameters(
  document: OADocument,
  pathLevel: OAParameter[] | undefined,
  operationLevel: OAParameter[] | undefined,
): OAParameter[] {
  const resolve = (list: OAParameter[] | undefined) =>
    (list ?? [])
      .map((p) => resolveRef<OAParameter>(document, p))
      .filter((p): p is OAParameter => !!p)

  const base = resolve(pathLevel)
  const own = resolve(operationLevel)
  // Identity is (name, in) per the spec — a `limit` query and a `limit` header are two parameters.
  const key = (p: OAParameter) => `${p.in}:${p.name}`
  const overridden = new Set(own.map(key))
  // Path-level parameters are inherited by every operation. Merge them here so a shared `:id`
  // remains available to every request under the path.
  return [...base.filter((p) => !overridden.has(key(p))), ...own]
}

interface Buckets {
  query: Pair[]
  headers: Pair[]
  path: Pair[]
}

function bucketParameters(document: OADocument, parameters: OAParameter[]): Buckets {
  const out: Buckets = { query: [], headers: [], path: [] }
  for (const parameter of parameters) {
    if (!parameter.name) continue
    const value = parameterValue(document, parameter.schema, parameter.example)
    // An OPTIONAL parameter imports switched off: it is documentation, not part of the call, and a
    // request that silently sends every optional filter is not the request the endpoint describes.
    // A path parameter is never optional — the url does not parse without it.
    const pair: Pair = { name: parameter.name, value }
    switch (parameter.in) {
      case 'query':
        out.query.push(parameter.required === true ? pair : { ...pair, disabled: true })
        break
      case 'header':
        out.headers.push(parameter.required === true ? pair : { ...pair, disabled: true })
        break
      case 'path':
        out.path.push(pair)
        break
      // `cookie` is skipped: it would have to be folded into a Cookie header, and a spec's cookie
      // auth is better expressed through the security scheme that names it. A parameter with no
      // `in` at all is invalid — and a spec in the wild is not obliged to be valid.
      case 'cookie':
      case undefined:
      default:
        break
    }
  }
  return out
}

/** JSON-ish media types we can build an example body for. */
function pickMediaType(content: Record<string, unknown> | undefined): string | null {
  const types = Object.keys(content ?? {})
  if (types.length === 0) return null
  // Use a ranked preference so the ordering of a YAML map cannot make `*/*` beat a later JSON body
  // that can produce a useful example.
  const json = types.find((t) => t.includes('json'))
  if (json) return json
  const form = types.find((t) => t.includes('x-www-form-urlencoded'))
  if (form) return form
  return types[0]
}

function bodyFor(
  document: OADocument,
  requestBody: OARequestBody | undefined,
): RequestBody | undefined {
  const resolved = resolveRef<OARequestBody>(document, requestBody)
  if (!resolved?.content) return undefined
  const mediaType = pickMediaType(resolved.content)
  if (!mediaType) return undefined

  const media = resolved.content[mediaType]
  const example = media?.example !== undefined ? media.example : exampleFor(document, media?.schema)

  if (mediaType.includes('json')) {
    const text = example === undefined ? '' : JSON.stringify(example, null, 2)
    // The vendor suffix is dropped (`application/vnd.api+json` → `application/json`) only when it
    // IS plain json; a vendor type is a real content negotiation and the server may require it.
    return { mimeType: mediaType, text }
  }
  if (mediaType.includes('x-www-form-urlencoded')) {
    const form: Pair[] =
      example && typeof example === 'object' && !Array.isArray(example)
        ? Object.entries(example).map(([name, value]) => ({ name, value: String(value ?? '') }))
        : []
    return { mimeType: mediaType, form }
  }
  // A type we cannot illustrate — carry the content type so the request is still correct.
  return { mimeType: mediaType }
}

export function convertOpenApi(text: string, options?: ImportOptions): ImportedRequest[] | null {
  const document = parseDocument(text)
  if (!document || typeof document.openapi !== 'string' || !OPENAPI_3.test(document.openapi)) {
    return null
  }
  return convertOpenApiDocument(document, text, options)
}

/**
 * Walk an OpenAPI 3 document into requests. Split from `convertOpenApi` so the SWAGGER 2 importer
 * can reuse it: the two formats differ in how they spell a base url, a body and a security scheme,
 * and agree on everything after that. `swagger2.ts` translates the spelling and lands here, so
 * fixes to $ref resolution, example generation, auth, and path parameters serve both formats.
 *
 * `notesKey` is the ORIGINAL source text: `openApiNotes` is looked up by it, and a swagger 2 import
 * must be able to find the notes for the text the user actually pasted, not for the translation.
 */
export function convertOpenApiDocument(
  document: OADocument,
  notesKey: string,
  options?: ImportOptions,
): ImportedRequest[] {
  const base = baseUrlFrom(document.servers, options?.baseUrl)
  const slug = apiSlug(document)
  const requests: ImportedRequest[] = []
  // `security.ts` computes `unsupported` so an import 'does not silently drop' a scheme it cannot
  // sign. That was the intent — but the value was discarded here, so a spec secured only by oauth2
  // imported every endpoint as `auth: none` and said NOTHING. The report is the whole point of
  // computing it.
  const unsupportedAuth = new Set<string>()

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object' || isSpecExtension(path)) continue

    for (const method of OA_METHODS) {
      const raw = pathItem[method]
      // Only a plain object is an operation. A path item also carries `parameters` (an array),
      // `servers`, `summary`, `$ref` and `x-*` extensions — none of which is a request.
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const operation = raw as OAOperation

      const httpMethod = parseMethod(method)
      if (!httpMethod) continue // OPTIONS/HEAD are in OA_METHODS and in ours; TRACE is in neither

      const parameters = mergeParameters(document, pathItem.parameters, operation.parameters)
      const buckets = bucketParameters(document, parameters)
      const { auth, unsupported } = authForOperation(document, slug, operation.security)
      if (unsupported) unsupportedAuth.add(unsupported)
      const body = bodyFor(document, operation.requestBody)

      const spec: RequestSpec = {
        url: `${base}${pathToPlaceholders(path)}`,
        method: httpMethod,
        headers: buckets.headers,
        query: buckets.query,
        auth,
        ...(buckets.path.length > 0 ? { pathParameters: buckets.path } : {}),
        ...(body ? { body } : {}),
      }
      requests.push({ name: operationName(path, method, operation), spec })
    }
  }

  // Claimed but empty is not a match: a document that is OpenAPI-shaped but describes nothing
  // should let the chain keep looking rather than report a successful import of zero requests.
  unsupportedByDoc.set(notesKey, [...unsupportedAuth])
  return requests
}

/**
 * Auth schemes the spec declares that we cannot sign.
 *
 * `security.ts` computed this all along, so an import "does not silently drop" a scheme — and the
 * value was discarded, so a spec secured only by oauth2 imported every endpoint as `auth: none`
 * and said nothing at all. Reporting it is the whole reason it is computed.
 */
export function openApiNotes(text: string): string[] {
  const found = collectUnsupportedAuth(text)
  if (found.length === 0) return []
  return [
    `Auth scheme(s) ${found.map((a) => `\`${a}\``).join(', ')} are declared by the spec but cannot be signed here, ` +
      'so those requests imported UNAUTHENTICATED rather than carrying an auth that would not work. ' +
      'Supported: http basic, http bearer, apiKey.',
  ]
}

export const openApiImporter: Importer = {
  id: 'openapi3',
  name: 'OpenAPI 3 spec',
  convert: convertOpenApi,
  notes: openApiNotes,
}

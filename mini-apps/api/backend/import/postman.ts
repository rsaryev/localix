/**
 * Postman v2 collection → RequestSpecs. The format most teams already have.
 *
 * Three things matter for this mini app's flat request model:
 *
 *   1. AUTH INHERITS (see ./postman/auth.ts). The parent chain is threaded through the import so a
 *      collection-level bearer reaches each flat saved request.
 *   2. `{{variables}}` NEED NO TRANSLATION. Postman's syntax already matches the local non-expression
 *      template grammar (see ../template.ts), including hyphenated names.
 *   3. `{{$dynamic}}` IS REPORTED, not faked. The local template grammar does not resolve Postman's
 *      generated `$`-prefixed variables, so each one is surfaced instead of being sent literally.
 */

import type { Pair, RequestBody, RequestSpec } from '../request-spec'
import { parseMethod } from '../request-spec'
import type { ImportedRequest, Importer } from './types'
import { resolveAuth } from './postman/auth'
import { convertUrl } from './postman/url'
import {
  isEnabled,
  isPostmanCollection,
  pairValue,
  type PostmanBody,
  type PostmanCollection,
  type PostmanItem,
  type PostmanKeyValue,
  type PostmanRequest,
} from './postman/types'

/** Postman's dynamic variables: `{{$guid}}`, `{{$randomInt}}`, … — generated, not defined. */
const DYNAMIC_VAR_RE = /\{\{\s*\$([A-Za-z0-9_]+)\s*\}\}/g

export interface PostmanNotes {
  /** Dynamic variables we cannot generate, by name. */
  dynamic: string[]
  /** Auth schemes the collection declares that we cannot sign. */
  unsupportedAuth: string[]
  /** Requests whose body mode we cannot carry. */
  droppedBodies: string[]
  /** Collection-level `variable[]` — they map onto our environments. */
  variables: Pair[]
}

function pairs(list: PostmanKeyValue[] | string | undefined): Pair[] {
  if (!Array.isArray(list)) return []
  const out: Pair[] = []
  for (const pair of list) {
    if (typeof pair.key !== 'string' || pair.key === '') continue
    out.push({
      name: pair.key,
      value: pairValue(pair),
      ...(isEnabled(pair) ? {} : { disabled: true }),
    })
  }
  return out
}

function convertBody(
  body: PostmanBody | undefined,
  notes: NoteSink,
  name: string,
): RequestBody | undefined {
  const mode = body?.mode
  if (!body || !mode) return undefined

  switch (mode) {
    case 'raw': {
      const text = body.raw ?? ''
      if (text === '') return undefined
      // Preserve known raw-body languages so HTML and JavaScript are not flattened to text/plain.
      const language = body.options?.raw?.language?.toLowerCase()
      const mimeType =
        language === 'json'
          ? 'application/json'
          : language === 'xml'
            ? 'application/xml'
            : language === 'html'
              ? 'text/html'
              : language === 'javascript'
                ? 'application/javascript'
                : 'text/plain'
      return { mimeType, text }
    }
    case 'urlencoded':
      return { mimeType: 'application/x-www-form-urlencoded', form: pairs(body.urlencoded) }
    case 'formdata':
      return { mimeType: 'multipart/form-data', form: pairs(body.formdata) }
    case 'graphql': {
      // A GraphQL call IS a JSON POST — `{query, variables}` over `application/json` is what
      // graphql-over-http specifies and what this always put on the wire, back when the mini app
      // carried an `application/graphql` marker and translated it at send time. The marker is
      // gone; the bytes are identical. So a Postman GraphQL request still imports, and still
      // sends exactly what it sent before — it is simply a POST with a JSON body now, which is
      // all it ever was.
      const { query, variables } = body.graphql ?? {}
      if (!query) return undefined
      return { mimeType: 'application/json', text: JSON.stringify({ query, variables }, null, 2) }
    }
    case 'file':
      // A file body cannot survive a JSON import because the bytes are absent from the collection.
      // Report the loss instead of quietly producing a POST with no payload.
      notes.droppedBodies.push(name)
      return undefined
    default:
      notes.droppedBodies.push(name)
      return undefined
  }
}

interface NoteSink {
  dynamic: Set<string>
  unsupportedAuth: Set<string>
  droppedBodies: string[]
}

/** Record any `{{$dynamic}}` names in `text`. */
function noteDynamic(text: string | undefined, notes: NoteSink): void {
  if (!text) return
  for (const m of text.matchAll(DYNAMIC_VAR_RE)) notes.dynamic.add(m[1])
}

/** `folder / subfolder / request` → a flat, readable, sluggable name. */
export function itemName(path: readonly string[], name: string | undefined): string {
  const raw = [...path, name?.trim() || 'request'].filter((s) => s !== '').join('-')
  return (
    raw
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'request'
  )
}

function convertRequest(
  item: PostmanItem,
  path: readonly string[],
  inheritedAuth: RequestSpec['auth'],
  notes: NoteSink,
): ImportedRequest | null {
  // Postman allows `item.request` to be a bare URL string; normalize it before conversion.
  const request: PostmanRequest =
    typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request ?? {})

  const { url, query, pathParameters } = convertUrl(request.url)
  if (!url) return null

  const name = itemName(path, item.name)
  const { auth, unsupported } = resolveAuth(request.auth, inheritedAuth)
  if (unsupported) notes.unsupportedAuth.add(unsupported)

  const headers = pairs(request.header)
  const body = convertBody(request.body, notes, name)

  for (const text of [
    url,
    ...query.map((q) => q.value),
    ...headers.map((h) => h.value),
    body?.text,
  ]) {
    noteDynamic(text, notes)
  }

  const spec: RequestSpec = {
    url,
    method: parseMethod(request.method) ?? 'GET',
    headers,
    query,
    auth,
    ...(pathParameters.length > 0 ? { pathParameters } : {}),
    ...(body ? { body } : {}),
  }
  return { name, spec }
}

/**
 * Walk `item[]`, which nests: a node with a `request` is a request, anything else is a folder.
 * That is Postman's only discriminator — there is no type field.
 */
function walk(
  items: PostmanItem[] | undefined,
  path: readonly string[],
  inheritedAuth: RequestSpec['auth'],
  notes: NoteSink,
  depth: number,
): ImportedRequest[] {
  // A collection is authored in a UI and cannot nest this far; the cap is a backstop against a
  // hand-edited file with a cycle, which `JSON.parse` cannot produce but a generator could.
  if (!Array.isArray(items) || depth > 20) return []

  const out: ImportedRequest[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (item.request !== undefined) {
      const converted = convertRequest(item, path, inheritedAuth, notes)
      if (converted) out.push(converted)
      continue
    }
    // A folder's auth becomes what its children inherit; flat saved requests cannot defer this walk.
    const folderAuth = resolveAuth(item.auth, inheritedAuth)
    if (folderAuth.unsupported) notes.unsupportedAuth.add(folderAuth.unsupported)
    out.push(
      ...walk(item.item, [...path, item.name?.trim() ?? ''], folderAuth.auth, notes, depth + 1),
    )
  }
  return out
}

export interface PostmanImport {
  requests: ImportedRequest[]
  notes: PostmanNotes
}

/** The full conversion, notes and all — used by the action to report what it could not carry. */
export function convertPostmanCollection(text: string): PostmanImport | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPostmanCollection(doc)) return null
  const collection = doc as PostmanCollection

  const notes: NoteSink = { dynamic: new Set(), unsupportedAuth: new Set(), droppedBodies: [] }
  // The collection's own auth is the root of the inheritance chain — this is the bearer token
  // people set once and expect every request to use.
  const root = resolveAuth(collection.auth, { type: 'none' })
  if (root.unsupported) notes.unsupportedAuth.add(root.unsupported)

  const requests = walk(collection.item, [], root.auth, notes, 0)
  const variables = pairs(collection.variable)
  for (const v of variables) noteDynamic(v.value, notes)

  return {
    requests,
    notes: {
      dynamic: [...notes.dynamic],
      unsupportedAuth: [...notes.unsupportedAuth],
      droppedBodies: notes.droppedBodies,
      variables,
    },
  }
}

export function convertPostman(text: string): ImportedRequest[] | null {
  return convertPostmanCollection(text)?.requests ?? null
}

/**
 * What a Postman collection carries that we do not. Prose, not data — it is read by a person (or a
 * model) deciding what to do next, and every line names the fix.
 */
export function postmanNotes(text: string): string[] {
  const out = convertPostmanCollection(text)
  if (!out) return []
  const { dynamic, unsupportedAuth, droppedBodies, variables } = out.notes
  const notes: string[] = []

  if (dynamic.length > 0) {
    notes.push(
      `This collection uses Postman's DYNAMIC variables (${dynamic.map((d) => `\`{{$${d}}}\``).join(', ')}), ` +
        'which are generated per send and which this mini app does not implement — they are NOT resolved and NOT ' +
        'reported as missing, so a request using one would send the literal text. Replace each with a real value, ' +
        'or with an environment variable you define.',
    )
  }
  if (unsupportedAuth.length > 0) {
    notes.push(
      `Auth type(s) ${unsupportedAuth.map((a) => `\`${a}\``).join(', ')} were declared but cannot be signed here, ` +
        'so those requests imported unauthenticated rather than pretending. Supported: basic, bearer, apikey.',
    )
  }
  if (droppedBodies.length > 0) {
    notes.push(
      `A file upload body on ${droppedBodies.map((n) => `"${n}"`).join(', ')} could not be imported — the bytes were ` +
        'never in the collection. Attach the file another way, or send the request without it.',
    )
  }
  if (variables.length > 0) {
    notes.push(
      `The collection defines ${variables.length} variable(s) (${variables.map((v) => `\`${v.name}\``).join(', ')}). ` +
        'Requests reference them as `{{name}}` — create a matching environment so they resolve: ' +
        `{"action":"save","target":"environment","name":"postman","variables":${JSON.stringify(variables.map((v) => ({ name: v.name, value: v.value })))}} ` +
        'on the api_client tool, then activate it.',
    )
  }
  return notes
}

export const postmanImporter: Importer = {
  id: 'postman',
  name: 'Postman collection',
  convert: convertPostman,
  notes: postmanNotes,
}

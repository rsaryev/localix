/**
 * Insomnia exports (v2/v3/v4) → RequestSpecs.
 *
 * The export's `authentication`, pair, and body fields map closely to the local request model, so
 * most conversion is direct field mapping.
 *
 * Two things are NOT renames, and they are the whole reason this is a module rather than a cast:
 *
 *   1. AUTH INHERITS through `parentId`. Insomnia exports a FLAT `resources` array where a request
 *      with `authentication: {}` inherits from its request_group, which inherits from the
 *      workspace — resolved at runtime by walking the chain. The saved model is flat, so the chain
 *      is walked during import or inherited auth would be lost.
 *   2. Insomnia uses `{{ _.var }}` while the local template grammar uses `{{ var }}`. Its nunjucks
 *      templates namespace variables under `_`, so a real export says `{{ _.base_url }}`. The local
 *      substitution would treat `_.base_url` as the variable name, which no environment defines,
 *      and report it missing on every send. It is normalised on the way in.
 */

import { parse as parseYaml } from 'yaml'
import type { Pair, RequestAuth, RequestBody, RequestSpec } from '../request-spec'
import { parseMethod } from '../request-spec'
import type { ImportedEnvironment, ImportedRequest, Importer } from './types'

/** The export formats whose `resources` array we can read. */
const SUPPORTED_FORMATS = [2, 3, 4]

interface InsoPair {
  name?: string
  value?: string
  disabled?: boolean
}

interface InsoResource {
  _id?: string
  _type?: string
  parentId?: string | null
  name?: string
  url?: string
  method?: string
  headers?: InsoPair[]
  parameters?: InsoPair[]
  pathParameters?: { name?: string; value?: string }[]
  body?: { mimeType?: string | null; text?: string; params?: InsoPair[] } | string
  authentication?: Record<string, unknown>
  /** request_group / workspace only. */
  environment?: Record<string, unknown>
  /** environment resources. */
  data?: Record<string, unknown>
}

interface InsoExport {
  __export_format?: number
  resources?: InsoResource[]
}

/**
 * `{{ _.base_url }}` → `{{base_url}}`.
 *
 * Only the `_.` namespace and the bracket form Insomnia rewrites hyphenated names into
 * (`{{ _['my-var'] }}`) — everything else is left exactly as written. A `{% tag %}` is NOT
 * translated: those belong to Insomnia's template engine (faker, response-chaining, prompts), and
 * inventing a value without that engine would be worse than leaving the tag visible.
 */
export function normaliseTemplating(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(
    /\{\{\s*_(?:\.([A-Za-z0-9_$]+)|\[['"]([^'"]+)['"]\])\s*\}\}/g,
    (_m, dotted, bracketed) => `{{${dotted ?? bracketed}}}`,
  )
}

const t = (v: string | undefined | null): string => normaliseTemplating(v ?? '')

function pairs(list: InsoPair[] | undefined): Pair[] {
  const out: Pair[] = []
  for (const pair of list ?? []) {
    if (typeof pair.name !== 'string' || pair.name === '') continue
    out.push({
      name: t(pair.name),
      value: t(pair.value),
      ...(pair.disabled ? { disabled: true } : {}),
    })
  }
  return out
}

/**
 * Insomnia auth fields → the local auth union.
 *
 * `disabled: true` means the auth block exists but is switched off — it is NOT inheritance, so it
 * resolves to none rather than falling through to the parent.
 */
export function convertAuth(auth: Record<string, unknown> | undefined): {
  auth: RequestAuth | null
  unsupported: string | null
} {
  const type = typeof auth?.type === 'string' ? auth.type.toLowerCase() : undefined
  // `{}` — the shape Insomnia writes for "inherit from my parent".
  if (!auth || !type) return { auth: null, unsupported: null }
  if (auth.disabled === true || type === 'none')
    return { auth: { type: 'none' }, unsupported: null }

  const str = (k: string) => (typeof auth[k] === 'string' ? (auth[k] as string) : '')
  switch (type) {
    case 'bearer': {
      const token = t(str('token'))
      return token
        ? { auth: { type: 'bearer', token }, unsupported: null }
        : { auth: null, unsupported: null }
    }
    case 'basic':
      return {
        auth: { type: 'basic', username: t(str('username')), password: t(str('password')) },
        unsupported: null,
      }
    case 'apikey': {
      const key = t(str('key'))
      if (!key) return { auth: null, unsupported: null }
      const addTo = str('addTo').toLowerCase()
      return {
        auth: {
          type: 'apikey',
          key,
          value: t(str('value')),
          addTo: addTo === 'query' ? 'query' : addTo === 'cookie' ? 'cookie' : 'header',
        },
        unsupported: null,
      }
    }
    default:
      // oauth1/oauth2/digest/ntlm/awsIam/hawk/asap/netrc — named in their model, unsignable by us.
      return { auth: null, unsupported: type }
  }
}

function convertBody(body: InsoResource['body']): RequestBody | undefined {
  // v2 wrote a bare string; v3+ writes the object expected by the local request model.
  if (typeof body === 'string') return body === '' ? undefined : { text: normaliseTemplating(body) }
  if (!body) return undefined
  const mimeType = body.mimeType ?? undefined
  if (body.params?.length) return { mimeType, form: pairs(body.params) }
  if (!body.text) return undefined
  return { mimeType, text: normaliseTemplating(body.text) }
}

/**
 * Header names that carry one value. Everything else accumulates — see `inheritHeaders`.
 */
const SINGLE_VALUE_HEADERS = [
  'proxy-authorization',
  'content-length',
  'content-type',
  'content-encoding',
  'content-location',
  'connection',
  'host',
  'upgrade',
  'range',
  'trailer',
]

/**
 * HEADERS INHERIT THROUGH `parentId` TOO — and they do not merely override.
 *
 * Header inheritance must be materialized alongside auth inheritance. Otherwise a header set once
 * on a request group silently disappears from every imported child request.
 *
 * The merge follows HTTP field semantics:
 *   - outermost folder first, then inner folders, then the request itself — nearest wins;
 *   - a SINGLE_VALUE header is REPLACED (two `Content-Type`s is not a thing);
 *   - any other header ACCUMULATES, comma-joined, which is how HTTP spells a repeated header on
 *     one line. That matters here beyond fidelity: our send path (`toHeaderInit`) is a
 *     `Record<string, string>`, so it can only carry one value per name — comma-joining is not a
 *     stylistic choice, it is the only way a repeated `Accept` survives us at all;
 *   - a disabled or blank-named header contributes nothing TO THE MERGE;
 *   - the casing of the LAST writer wins.
 *
 * THE MERGE IS SEND-TIME LOGIC, AND THIS IS IMPORT. That distinction is the whole reason `own` is
 * a separate parameter rather than just the last context. Wire construction discards disabled
 * headers, but importing stores them as saved-but-off (`activePairs` drops them at send time).
 * Ancestors and the request's enabled headers merge; the request's disabled headers pass through
 * untouched.
 */
export function inheritHeaders(
  ancestors: readonly (InsoPair[] | undefined)[],
  own: InsoPair[] | undefined,
): Pair[] {
  const values = new Map<string, string>()
  const casing = new Map<string, string>()
  for (const { name, value, disabled } of [...ancestors, own].flatMap((h) => h ?? [])) {
    if (disabled || !name?.trim()) continue
    const key = name.toLowerCase()
    casing.set(key, name)
    const merged =
      SINGLE_VALUE_HEADERS.includes(key) || !values.has(key)
        ? t(value)
        : `${values.get(key)}, ${t(value)}`
    values.set(key, merged)
  }
  const merged: Pair[] = [...values].map(([key, value]) => ({ name: casing.get(key)!, value }))
  // The request's own switched-off headers, preserved as the user left them.
  const off: Pair[] = []
  for (const pair of own ?? []) {
    if (pair.disabled && pair.name?.trim()) {
      off.push({ name: t(pair.name), value: t(pair.value), disabled: true })
    }
  }
  return [...merged, ...off]
}

/** `folder / subfolder / request` → one flat, sluggable name. */
export function resourceName(path: readonly string[], name: string | undefined): string {
  const raw = [...path, name?.trim() || 'request'].filter((s) => s !== '').join('-')
  return (
    raw
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'request'
  )
}

export interface InsomniaNotes {
  unsupportedAuth: string[]
  /** Environment resources — they map onto ours. */
  environments: { name: string; variables: Pair[] }[]
  /** `{% tag %}`s we cannot evaluate (faker, response chaining, prompts). */
  tags: string[]
}

export interface InsomniaImport {
  requests: ImportedRequest[]
  notes: InsomniaNotes
}

/** `{% faker 'guid' %}`, `{% response 'body', … %}` — their engine's, not ours. */
const TAG_RE = /\{%\s*([A-Za-z0-9_]+)/g

export function convertInsomniaExport(text: string): InsomniaImport | null {
  let doc: InsoExport
  try {
    // v4 exports as YAML, and YAML is a JSON superset, so one parser reads every supported version.
    doc = parseYaml(text) as InsoExport
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object') return null
  if (typeof doc.__export_format !== 'number' || !SUPPORTED_FORMATS.includes(doc.__export_format)) {
    return null
  }
  const resources = doc.resources
  if (!Array.isArray(resources)) return null

  const byId = new Map<string, InsoResource>()
  for (const r of resources) if (typeof r?._id === 'string') byId.set(r._id, r)

  /** Walk `parentId` to the root, nearest-first. Capped: a hand-edited file can cycle. */
  const ancestors = (r: InsoResource): InsoResource[] => {
    const out: InsoResource[] = []
    const seen = new Set<string>()
    let cur = r
    for (let i = 0; i < 20; i++) {
      const parent = cur.parentId ? byId.get(cur.parentId) : undefined
      if (!parent?._id || seen.has(parent._id)) break
      seen.add(parent._id)
      out.push(parent)
      cur = parent
    }
    return out
  }

  const unsupportedAuth = new Set<string>()
  const tags = new Set<string>()
  const noteTags = (s: string | undefined) => {
    for (const m of (s ?? '').matchAll(TAG_RE)) tags.add(m[1])
  }

  const requests: ImportedRequest[] = []
  for (const resource of resources) {
    if (resource?._type !== 'request' || typeof resource.url !== 'string') continue

    const chain = ancestors(resource)
    // Folders only — the workspace is the root and contributes no path segment.
    const path = chain
      .filter((a) => a._type === 'request_group')
      .reverse()
      .map((a) => a.name?.trim() ?? '')

    // AUTH: the request's own, else the nearest ancestor that declares one. Materialize the chain
    // because the saved model is flat and cannot defer inheritance until send time.
    //
    // Ordinary exports declare inherited auth on folders, not the workspace. A hand-edited file can
    // still contain workspace auth, so read it rather than silently dropping an explicit credential.
    let resolved = convertAuth(resource.authentication)
    if (resolved.unsupported) unsupportedAuth.add(resolved.unsupported)
    for (const ancestor of chain) {
      if (resolved.auth) break
      const inherited = convertAuth(ancestor.authentication)
      if (inherited.unsupported) unsupportedAuth.add(inherited.unsupported)
      resolved = inherited
    }

    const url = t(resource.url)
    // Outermost ancestor first, then inner, then the request — nearest wins. `chain` is
    // nearest-first, so it is reversed. As with auth, also accept a workspace header if a hand-edited
    // export contains one.
    const headers = inheritHeaders(
      [...chain].reverse().map((a) => a.headers),
      resource.headers,
    )
    const query = pairs(resource.parameters)
    const body = convertBody(resource.body)
    const pathParameters: Pair[] = []
    for (const parameter of resource.pathParameters ?? []) {
      if (typeof parameter.name === 'string' && parameter.name !== '') {
        pathParameters.push({ name: parameter.name, value: t(parameter.value) })
      }
    }

    for (const s of [
      url,
      body?.text,
      ...headers.map((h) => h.value),
      ...query.map((q) => q.value),
    ]) {
      noteTags(s)
    }

    const spec: RequestSpec = {
      url,
      method: parseMethod(resource.method) ?? 'GET',
      headers,
      query,
      auth: resolved.auth ?? { type: 'none' },
      ...(pathParameters.length > 0 ? { pathParameters } : {}),
      ...(body ? { body } : {}),
    }
    requests.push({ name: resourceName(path, resource.name), spec })
  }

  // Environment resources map onto ours 1:1 — a flat name→value record.
  const environments: InsomniaNotes['environments'] = []
  for (const r of resources) {
    if (r?._type !== 'environment' || !r.data || typeof r.data !== 'object') continue
    const variables: Pair[] = []
    for (const [name, value] of Object.entries(r.data)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        variables.push({ name, value: normaliseTemplating(String(value)) })
      }
    }
    if (variables.length > 0) environments.push({ name: r.name?.trim() || 'insomnia', variables })
  }

  return {
    requests,
    notes: { unsupportedAuth: [...unsupportedAuth], environments, tags: [...tags] },
  }
}

export function convertInsomnia(text: string): ImportedRequest[] | null {
  return convertInsomniaExport(text)?.requests ?? null
}

/** What an Insomnia export carries that we do not. */
export function insomniaNotes(text: string): string[] {
  const out = convertInsomniaExport(text)
  if (!out) return []
  const { unsupportedAuth, tags } = out.notes
  const notes: string[] = []

  if (tags.length > 0) {
    notes.push(
      `This export uses Insomnia TEMPLATE TAGS (${tags.map((x) => `\`{% ${x} %}\``).join(', ')}), which are ` +
        'evaluated by its template engine — faker values, response chaining, prompts. This plugin substitutes ' +
        'variables and does not evaluate anything, so those are left as literal text and the requests using them ' +
        'need a real value before they will work.',
    )
  }
  if (unsupportedAuth.length > 0) {
    notes.push(
      `Auth type(s) ${unsupportedAuth.map((a) => `\`${a}\``).join(', ')} could not be signed here, so those ` +
        'requests imported UNAUTHENTICATED rather than carrying an auth that would not work. Supported: basic, bearer, apikey.',
    )
  }
  return notes
}

/**
 * The export's `environment` resources.
 *
 * This used to be a NOTE — a sentence handing the reader a `manage_environment` call to retype,
 * with the values we had already parsed pasted into it. That was a workaround for the importer
 * contract carrying only requests; it carries environments now, so they are simply imported.
 */
export function insomniaEnvironments(text: string): ImportedEnvironment[] {
  return convertInsomniaExport(text)?.notes.environments ?? []
}

export const insomniaImporter: Importer = {
  id: 'insomnia',
  name: 'Insomnia export',
  convert: convertInsomnia,
  environments: insomniaEnvironments,
  notes: insomniaNotes,
}

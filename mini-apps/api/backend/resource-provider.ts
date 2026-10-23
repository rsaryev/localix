/**
 * REST resource provider — a `ResourceRefProvider` owning the `localix://resource/api` provider namespace, sibling of the
 * database / docker / trading providers. It turns saved requests into a referenceable tree the
 * composer `@`-menu drills, so a user can `@`-mention a saved request (or drag it into chat) and
 * the model sees what it does WITHOUT having to call the tool to find out.
 *
 * This is the difference between a mini app that merely has a tool and one that is native: `list`
 * costs a tool round-trip and only the model can start it; an `@`-ref is something the USER
 * reaches for, and it lands in context before the turn begins.
 *
 * SECURITY: an expansion is built through `redactSpec`, so a literal credential can never reach
 * model-facing text. A `${secret:KEY}` reference is shown deliberately — it is a pointer, not a
 * secret, and seeing it is how the model learns which key a request uses.
 */

import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
  ResourceRefScope,
} from '@localixai/mini-app-sdk/backend'
import { redactSpec } from './store'
import { describeRequest } from './request-summary'
import type { CollectionRequest, CollectionStore } from './collection/store'
import { activePairs, type RequestAuth } from './request-spec'
import { buildRequestUri, parseRestUri } from './uri'
import { PROVIDER } from './resource-provider-id'
import { formatBodyForModel } from '../model/model-context'

/**
 * Narrow port — the two reads this provider needs. Nothing here can mutate or send.
 *
 * `userId` stays in the signature even though the collection is keyed by PROJECT, not by user:
 * the `ResourceRefProvider` contract passes it on every call, and a port that quietly dropped it
 * would be one refactor away from a provider that reads someone else's tree. It is the caller's
 * job to hand over a store already scoped to the right place.
 */
export interface ResourceRequestPort {
  list(userId: string, scope?: ResourceRefScope): Promise<CollectionRequest[]>
  get(userId: string, name: string, scope?: ResourceRefScope): Promise<CollectionRequest | null>
}

/** Session-aware port used by the process-global backend providers. */
export function scopedRequestPort(
  resolve: (userId: string, sessionId?: string) => Promise<CollectionStore | null>,
): ResourceRequestPort {
  return {
    async list(userId, scope) {
      return (await resolve(userId, scope?.sessionId))?.list() ?? []
    },
    async get(userId, name, scope) {
      return (await resolve(userId, scope?.sessionId))?.get(name) ?? null
    },
  }
}

function nodeFor(saved: CollectionRequest): ResourceNode {
  const spec = redactSpec(saved.spec)
  const auth = spec.auth.type === 'none' ? '' : ` · ${spec.auth.type}`
  return {
    uri: buildRequestUri(saved.name),
    label: saved.name,
    detail: `${spec.method} ${spec.url}${auth}`,
    hasChildren: false,
    icon: 'request',
  }
}

/**
 * The auth block, as the model should read it. `spec` is ALREADY redacted, so every value here is
 * either a `${secret:KEY}` reference or a mask — which is exactly the distinction worth showing:
 * "bearer, from ${secret:GH_TOKEN}" tells the model the request is ready to send and which key it
 * needs, while a bare "bearer" leaves it guessing whether a credential is configured at all.
 */
function authLines(auth: RequestAuth): string[] {
  switch (auth.type) {
    case 'none':
      return []
    case 'basic':
      return [`Auth: basic — user ${auth.username}, password ${auth.password}`]
    case 'bearer':
      return [`Auth: bearer — token ${auth.token}`]
    case 'apikey':
      return [`Auth: apikey — ${auth.key}: ${auth.value} (in ${auth.addTo ?? 'header'})`]
  }
}

/** Render a saved request as compact, model-facing markdown. */
export function expandRequest(saved: CollectionRequest): string {
  const spec = redactSpec(saved.spec)
  const lines: string[] = [`${spec.method} ${spec.url}`]

  const query = activePairs(spec.query)
  if (query.length > 0) {
    lines.push('', 'Query:')
    for (const { name, value } of query) lines.push(`  ${name}=${value}`)
  }

  const headers = activePairs(spec.headers)
  if (headers.length > 0) {
    lines.push('', 'Headers:')
    for (const { name, value } of headers) lines.push(`  ${name}: ${value}`)
  }

  const auth = authLines(spec.auth)
  if (auth.length > 0) lines.push('', ...auth)

  if (spec.body) {
    const { mimeType, text, form } = spec.body
    lines.push('', `Body (${mimeType ?? 'unknown type'}):`)
    if (form) for (const { name, value } of activePairs(form)) lines.push(`  ${name}=${value}`)
    else if (text) lines.push(formatBodyForModel(text, mimeType))
  }

  lines.push('', `Send it with the api_client tool: {"action":"send","name":"${saved.name}"}`)
  return lines.join('\n')
}

/**
 * The COLLECTION, as the model should read it: one line per saved request, in the store's order.
 *
 * This is the roster an agent needs before it can pick — the same thing `{"action":"list"}` prints,
 * reached without a tool round-trip because the USER put it in context. Each line carries the
 * method, the (redacted) url and the auth type, so choosing between eight saved requests never
 * requires expanding all eight.
 */
export function expandCollection(all: readonly CollectionRequest[]): string {
  if (all.length === 0) {
    return 'No saved requests yet. Save one with the api_client tool: {"action":"save","name":"github-user","url":"https://api.github.com/users/octocat"}'
  }
  const lines = [`${all.length} saved request${all.length === 1 ? '' : 's'}:`]
  for (const saved of all) {
    lines.push(`  ${describeRequest(saved)}`)
  }
  lines.push(
    '',
    'Read one in full by `@`-mentioning it, or send it with {"action":"send","name":"<name>"}.',
  )
  return lines.join('\n')
}

export function createRestResourceProvider(port: ResourceRequestPort): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'REST requests',

    async listChildren(userId, parentUri, _query, scope) {
      // A saved request is a leaf, so the ONLY level with children is the collection — reached
      // either as the menu's roots (`null`) or by its own URI, which is what makes the collection
      // linkable through an action row rather than only drillable.
      if (parentUri !== null && parseRestUri(parentUri)?.kind !== 'collection') return []
      const all = await port.list(userId, scope)
      return all.map(nodeFor)
    },

    async expand(userId, uri, scope): Promise<ResourceExpansion> {
      const node = parseRestUri(uri)
      if (!node)
        return { ok: false, error: `Not a localix://resource/${PROVIDER} request URI: ${uri}` }
      if (node.kind === 'collection') {
        return { ok: true, content: expandCollection(await port.list(userId, scope)) }
      }
      const saved = await port.get(userId, node.name, scope)
      if (!saved) return { ok: false, error: `No saved request named "${node.name}"` }
      return { ok: true, content: expandRequest(saved) }
    },
  }
}

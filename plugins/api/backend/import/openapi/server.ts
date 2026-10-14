/**
 * `servers` → the base url every imported request is built on.
 *
 * We inline the FIRST server rather than emitting a template: a template variable nothing can fill
 * would be a url that never resolves. Inlining is honest for a model that has no variables: the
 * request works immediately, and pointing it at another server is a url edit.
 *
 * Server VARIABLES are substituted from their `default`. When a variable has no default we leave
 * the `{placeholder}` in the url instead of throwing. Losing an entire API's import because
 * one spec omitted one default is a bad trade — the placeholder is visible, the other 40 endpoints
 * are usable, and the fix is an edit rather than a re-import.
 */

import type { OAServer } from './types'

/** `{name}` in a server url. Built per call — a module-level /g regex carries `lastIndex`, which
 *  would leak state between calls. */
const variableRe = () => /\{([^}]+)\}/g

const FALLBACK_SERVER = 'https://example.com'

/**
 * Substitute `{var}` with its default (or its first enum value, which a spec that lists one is
 * telling us is legal). An unknown variable is left as written.
 */
export function applyServerVariables(server: OAServer): string {
  const url = server.url ?? ''
  if (!server.variables) return url
  return url.replace(variableRe(), (match, name: string) => {
    const variable = server.variables?.[name]
    const value = variable?.default ?? variable?.enum?.[0]
    return typeof value === 'string' && value !== '' ? value : match
  })
}

/**
 * The base url to build requests on: the first server, variables filled, trailing slash stripped.
 *
 * A RELATIVE server url (`/v2`, which the spec allows and means "same host as the doc") cannot
 * become an absolute request on its own — we were handed a pasted document, not a URL to resolve
 * against. It falls back to the placeholder host, so the path is preserved and visibly needs a
 * host, rather than producing `new URL('/v2')` and throwing the whole import away.
 */
export function baseUrlFrom(servers: OAServer[] | undefined, explicitBase?: string): string {
  const first = servers?.find((s) => (s.url ?? '') !== '')
  const root = (explicitBase ?? FALLBACK_SERVER).replace(/\/+$/, '')
  if (!first) return root

  const resolved = applyServerVariables(first)
  // An ABSOLUTE server url wins over `explicitBase`: the document names its own host, and
  // overriding a host the spec actually states would be answering a question nobody asked. The
  // override exists for the relative case, which is the one the document cannot answer.
  const absolute = /^https?:\/\//i.test(resolved)
    ? resolved
    : `${root}${resolved.startsWith('/') ? '' : '/'}${resolved}`
  return absolute.replace(/\/+$/, '')
}

/** True when the base url is our placeholder — the caller says so rather than pretending. */
export function isPlaceholderHost(url: string): boolean {
  return url.startsWith(FALLBACK_SERVER)
}

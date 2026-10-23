/**
 * How a method and a status code LOOK. Pure — no React, so the row and the tab read one
 * vocabulary and a GET can never be blue in the sidebar and green in the tab.
 *
 * The mappings follow the convention a REST tool's user has already learned, because it is
 * arbitrary: DELETE is red and 4xx is a warning, and inventing our own would make them re-learn it
 * for nothing.
 *
 * Our `Chip` themes exactly `neutral | active | accent | info | warning | error | success`, so the
 * convention maps onto those tones and the colours resolve to our tokens rather than forking the
 * design system with extra tones.
 */

import type { HttpMethod } from '../../backend/request-spec'

/** The tone vocabulary `@localixai/kit/chip` already themes. Not ours to extend. */
export type Tone = 'neutral' | 'accent' | 'info' | 'warning' | 'error' | 'success'

/** PUT and PATCH share a tone: both are mutations short of a delete, and we have no third shade
 *  between warning and error to separate them with. */
const METHOD_TONES: Record<HttpMethod, Tone> = {
  GET: 'info',
  POST: 'success',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'error',
  HEAD: 'neutral',
  OPTIONS: 'neutral',
}

export function methodTone(method: HttpMethod): Tone {
  return METHOD_TONES[method] ?? 'neutral'
}

/** The two verbs too long for a fixed-width gutter. Only these are
 *  abbreviated — `OPTIONS`→`OPTS`, `DELETE`→`DEL` — so every label fits the same narrow
 *  column and the request NAMES beside them left-align on a clean edge. The rest already fit. */
const METHOD_LABELS: Partial<Record<HttpMethod, string>> = {
  OPTIONS: 'OPTS',
  DELETE: 'DEL',
}

/** The abbreviated code that rides the fixed-width method gutter. Same source of truth as the tone,
 *  so the row and the tab spell a method identically. Anything unabbreviated is its own name. */
export function methodLabel(method: HttpMethod): string {
  return METHOD_LABELS[method] ?? method
}

/**
 * 1xx info · 2xx success · 3xx info · 4xx warning · 5xx error.
 *
 * The 4xx/5xx split is the one that carries meaning: a 404 is the server answering CORRECTLY and
 * the request being wrong (your problem — fix it, don't retry), while a 500 is the server itself
 * failing (not your problem — maybe retry). Painting both one "error" red would erase the only
 * distinction that tells you what to do next.
 */
export function statusTone(status: number): Tone {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warning'
  if (status >= 300) return 'info'
  if (status >= 200) return 'success'
  return 'info'
}

/** Bytes as a person reads them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Milliseconds as a person reads them. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

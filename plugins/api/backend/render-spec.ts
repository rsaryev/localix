/**
 * Applying an environment's variables to a whole RequestSpec, at send time.
 *
 * Pure — it takes the variables, never the store. Rendering happens on a COPY: the saved request
 * keeps its `{{ base_url }}` and is re-rendered against whatever environment is active next time.
 * A spec that rendered in place would be a request that silently pinned itself to the first
 * environment it was ever sent against.
 *
 * WHAT IS RENDERED, and what is not:
 *   - url, query, headers, path parameters, body → yes. These are the request.
 *   - auth → NO. Auth already carries native-vault `${secret:KEY}` references directly. Keeping
 *     `{{variables}}` out of auth avoids two indirect grammars for one field and keeps the Auth
 *     editor, vault bindings and audit trail unambiguous.
 */

import { hasTemplate, renderTemplate } from './template'
import type { Pair, RequestBody, RequestSpec } from './request-spec'

export interface RenderedSpec {
  spec: RequestSpec
  /** Variable names the request used and the environment did not define. */
  missing: string[]
  /** Ways the render itself broke the request — see `bodyCorruption`. */
  problems: string[]
}

/**
 * Did substituting variables BREAK a JSON body?
 *
 * `{"name":"{{who}}"}` with `who = 'Ada "the boss"'` renders to `{"name":"Ada "the boss""}` — the
 * quotes close the string early and the server gets malformed JSON. A newline does the same. And
 * `a\b` is worse than malformed: it parses, because `\b` is a JSON backspace escape, so the value
 * silently becomes something else. Substitution is textual and JSON is not.
 *
 * WHY DETECT RATHER THAN ESCAPE. Escaping every value looks obvious and is wrong: `{{payload}}`
 * holding `{"a":1}`, substituted into a body that is just `{{payload}}`, is a legitimate
 * JSON-fragment injection — and escaping would turn it into the STRING `"{\"a\":1}"`. Whether a
 * variable is a string inside JSON or a fragment of JSON is genuinely ambiguous, and this module
 * cannot know. So it does not guess: it checks whether OUR substitution produced something the
 * server cannot read, and says so. ("Everyone has this hazard" is not a reason to send broken
 * JSON.)
 *
 * Only complains when a template was actually substituted. A body the user typed as invalid JSON
 * is their request — maybe the server is lenient — and not ours to block.
 */
function bodyCorruption(
  before: RequestBody | undefined,
  after: RequestBody | undefined,
): string | null {
  if (!before?.text || !after?.text) return null
  if (!hasTemplate(before.text)) return null // nothing was substituted; whatever it is, it is theirs
  if (!/json/i.test(after.mimeType ?? '')) return null
  try {
    JSON.parse(after.text)
    return null
  } catch {
    // It might have been invalid before too — then the render is not the culprit.
    try {
      JSON.parse(before.text.replace(/\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/g, 'x'))
    } catch {
      return null
    }
    return (
      'Substituting variables produced invalid JSON: a value contains a `"`, a newline or a `\\`, ' +
      'which are structural characters inside a JSON string. Substitution is textual — it cannot ' +
      'know your value was meant to be a string rather than a fragment of JSON. Either escape the ' +
      'value in the environment, or move the whole object into one variable and use it as the body.'
    )
  }
}

/** Render every string in a pair list, collecting misses. */
function renderPairs(
  pairs: Pair[] | undefined,
  vars: ReadonlyMap<string, string>,
  missing: Set<string>,
): Pair[] | undefined {
  if (!pairs) return pairs
  return pairs.map((pair) => {
    const name = renderTemplate(pair.name, vars)
    const value = renderTemplate(pair.value, vars)
    for (const m of [...name.missing, ...value.missing]) missing.add(m)
    return { ...pair, name: name.text, value: value.text }
  })
}

function renderBody(
  body: RequestBody | undefined,
  vars: ReadonlyMap<string, string>,
  missing: Set<string>,
): RequestBody | undefined {
  if (!body) return body
  const out: RequestBody = { ...body }
  if (typeof body.text === 'string') {
    const r = renderTemplate(body.text, vars)
    for (const m of r.missing) missing.add(m)
    out.text = r.text
  }
  if (body.form) out.form = renderPairs(body.form, vars, missing)
  return out
}

export function renderSpec(spec: RequestSpec, vars: ReadonlyMap<string, string>): RenderedSpec {
  const missing = new Set<string>()
  const url = renderTemplate(spec.url, vars)
  for (const m of url.missing) missing.add(m)
  const body = renderBody(spec.body, vars, missing)
  const corruption = bodyCorruption(spec.body, body)

  return {
    problems: corruption ? [corruption] : [],
    spec: {
      ...spec,
      url: url.text,
      headers: renderPairs(spec.headers, vars, missing) ?? [],
      query: renderPairs(spec.query, vars, missing) ?? [],
      pathParameters: renderPairs(spec.pathParameters, vars, missing),
      body,
      // auth is passed through untouched — see the header.
    },
    missing: [...missing],
  }
}

/**
 * The message for a request that names variables the active environment does not define.
 *
 * Loud, and consistent with "Secret not found": an unresolved variable is a setup step, and the
 * alternative — sending `{{base_url}}/users` — either throws an opaque URL parse error or, worse,
 * reaches a real but wrong place.
 */
export function missingVarsProblem(missing: readonly string[], environment: string | null): string {
  const names = missing.map((m) => `\`${m}\``).join(', ')
  const where = environment
    ? `the active environment "${environment}"`
    : 'any environment (none is active)'
  return (
    `This request uses ${missing.length === 1 ? 'a variable' : 'variables'} ${names}, which ${where} does not define. ` +
    `Define ${missing.length === 1 ? 'it' : 'them'} with {"action":"save","target":"environment","name":"${environment ?? 'dev'}","variables":[{"name":"${missing[0]}","value":"…"}]} ` +
    'on the api_client tool' +
    (environment
      ? '.'
      : ', then activate it with {"action":"use","target":"environment","name":"dev"}.')
  )
}

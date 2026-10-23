/**
 * `{{ name }}` variable substitution. Pure: no environment, no storage, no engine.
 *
 * THIS IS DELIBERATELY NOT A TEMPLATE LANGUAGE. A real template engine, with tags, filters and a
 * mini app extension surface, brings a sandboxing question with it.
 *
 * We have one problem: pointing a saved request at dev instead of prod. Importing a template
 * engine to solve it would import that sandboxing question too, into a mini app whose whole job is
 * sending user-supplied strings at the network. Substitution is the feature; an engine is a
 * language. So: no dependency, no tags, no filters, no expressions — a name maps to a string.
 *
 * An environment variable may point at the native vault. Its `${secret:KEY}` reference stays in
 * every observable render; only the dedicated send path supplies a resolved variable map.
 */

/**
 * `{{ name }}`, tolerant of inner spaces. Built per call — a module-level /g regex carries
 * `lastIndex` between calls, which is a bug this repo has already been bitten by (see the SDK's
 * secret-interpolate, whose header records the same lesson).
 */
const templateRe = () => /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

/** Cheap gate: no braces, nothing to do. Most requests have no variables at all. */
export function hasTemplate(text: string): boolean {
  return text.includes('{{') && text.includes('}}')
}

export interface RenderResult {
  text: string
  /** Names that had no value. The caller decides whether that is fatal. */
  missing: string[]
}

/**
 * Substitute every `{{ name }}` from `vars`.
 *
 * An UNKNOWN name is left as written and reported in `missing` — it is never replaced with an
 * empty string. `{{base_url}}/users` silently becoming `/users` is a request to a different place
 * that looks like it worked; leaving the braces makes the url visibly unfinished, and `missing`
 * lets the caller say which name to define.
 */
export function renderTemplate(text: string, vars: ReadonlyMap<string, string>): RenderResult {
  if (!hasTemplate(text)) return { text, missing: [] }
  const missing: string[] = []
  const out = text.replace(templateRe(), (match, name: string) => {
    const value = vars.get(name)
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name)
      return match
    }
    return value
  })
  return { text: out, missing }
}

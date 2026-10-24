/**
 * Our own reading of the type declarations Claude Code writes for a mod (`index.d.ts`): the
 * identifiers they name — each event and the field names of its input, each `$` namespace and its
 * method names, each render site and its prop names — and nothing else. No comment, type, example
 * or other text of the file is kept, so the committed `*.surface.json` is a list of names we
 * extracted, not a copy of the declarations (README.md, "Legal rules").
 *
 * A small scanner, not a TypeScript parser: it follows the layout those declarations use (one
 * `type Name = …;` or `interface Name { … }` per declaration, `;` between members) and resolves
 * a field list through references, `&`, `|`, `Omit`, `Pick`, `Partial` and `interface … extends`.
 */

import { byText } from '../probe/hooks/shape.js'

/** The text without comments; string literals are kept, so `'tool.call'` stays a key. */
function stripComments(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end - 1
    } else if (char === "'" || char === '"' || char === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== char) j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else out += char
  }
  return out
}

const OPEN = new Set(['{', '(', '[', '<'])
const CLOSE = new Set(['}', ')', ']', '>'])

/** Split `text` on `separator` where no bracket is open (`=>` is an arrow, not a bracket). */
function splitTop(text, separators) {
  const parts = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (OPEN.has(char)) depth++
    else if (CLOSE.has(char) && !(char === '>' && text[i - 1] === '=')) depth--
    else if (depth === 0 && separators.includes(char)) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** The end of the bracketed run that opens at `start`. */
function closing(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (OPEN.has(text[i])) depth++
    else if (CLOSE.has(text[i]) && !(text[i] === '>' && text[i - 1] === '=')) depth--
    if (depth === 0) return i
  }
  return text.length - 1
}

/** Every `type` and `interface` declaration, by name: its expression, or body and parents. */
function declarations(text) {
  const found = new Map()
  const pattern = /\b(type|interface)\s+([A-Za-z_$][\w$]*)/g
  for (let match; (match = pattern.exec(text));) {
    let at = match.index + match[0].length
    while (/\s/.test(text[at])) at++
    if (text[at] === '<') at = closing(text, at) + 1
    if (match[1] === 'type') {
      const equals = text.indexOf('=', at)
      if (equals < 0 || text.slice(at, equals).trim()) continue
      const rest = text.slice(equals + 1)
      found.set(match[2], { expr: splitTop(rest, [';'])[0] ?? '' })
    } else {
      const brace = text.indexOf('{', at)
      const head = text.slice(at, brace)
      const parents = /extends\s+([\s\S]*)/.exec(head)?.[1]
      found.set(match[2], {
        expr: text.slice(brace, closing(text, brace) + 1),
        parents: parents ? splitTop(parents, [',']) : [],
      })
    }
  }
  return found
}

const KEY = /^(?:readonly\s+)?(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*\??\s*([:(<])/

/** The members of an object type's `{ … }`: each key, and its type unless it is a method. */
function members(body) {
  return splitTop(body.trim().slice(1, -1), [';', ',']).flatMap((member) => {
    const match = KEY.exec(member)
    if (!match) return []
    const key = match[1] ?? match[2] ?? match[3]
    const type = match[4] === ':' ? member.slice(match[0].length).trim() : null
    return [{ key, type }]
  })
}

const literals = (text) => [...text.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])

/** The field names an expression's object type has, through references; `[]` when it has none. */
function fieldsOf(expr, decls, depth = 0) {
  return [...new Set(membersOf(expr, decls, depth).map((member) => member.key))].sort(byText)
}

function membersOf(expr, decls, depth) {
  if (!expr || depth > 8) return []
  const text = expr.trim().replace(/^[|&]\s*/, '')
  for (const separator of ['|', '&']) {
    const parts = splitTop(text, [separator])
    if (parts.length > 1) return parts.flatMap((part) => membersOf(part, decls, depth + 1))
  }
  if (text.startsWith('{')) return members(text)
  if (text.startsWith('(') && closing(text, 0) === text.length - 1)
    return membersOf(text.slice(1, -1), decls, depth + 1)
  const generic = /^([A-Za-z_$][\w$]*)\s*<([\s\S]*)>$/.exec(text)
  if (generic) {
    const [target, ...rest] = splitTop(generic[2], [','])
    const inner = membersOf(target, decls, depth + 1)
    if (generic[1] === 'Omit') {
      const dropped = new Set(literals(rest.join(',')))
      return inner.filter((member) => !dropped.has(member.key))
    }
    if (generic[1] === 'Pick') {
      const kept = new Set(literals(rest.join(',')))
      return inner.filter((member) => kept.has(member.key))
    }
    if (['Partial', 'Readonly', 'Required'].includes(generic[1])) return inner
    return membersOf(generic[1], decls, depth + 1)
  }
  const decl = /^[A-Za-z_$][\w$]*$/.test(text) ? decls.get(text) : undefined
  if (!decl) return []
  return [
    ...(decl.parents ?? []).flatMap((parent) => membersOf(parent, decls, depth + 1)),
    ...membersOf(decl.expr, decls, depth + 1),
  ]
}

const sortedObject = (entries) =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** The surface of a Claude Code version: names only, sorted. */
export function surfaceOf(declarationText) {
  const decls = declarations(stripComments(declarationText))
  const events = decls.get('EngineEventOf')
  if (!events) throw new Error('no EngineEventOf in the declarations: has their layout changed?')
  const api = decls.get('EngineInterface') ?? decls.get('CoreEngineInterface')
  const sites = decls.get('RenderPropsOf')
  const typed = (decl) => (decl ? membersOf(decl.parents ? decl.expr : decl.expr, decls, 0) : [])
  const withParents = (decl) => [
    ...(decl?.parents ?? []).flatMap((parent) => membersOf(parent, decls, 1)),
    ...typed(decl),
  ]
  return {
    events: sortedObject(
      typed(events).map(({ key, type }) => [key, type ? fieldsOf(type, decls) : []]),
    ),
    api: sortedObject(
      withParents(api)
        .filter(({ type }) => type)
        .map(({ key, type }) => [key, fieldsOf(type, decls)])
        .filter(([, methods]) => methods.length > 0),
    ),
    renderSites: sortedObject(
      typed(sites).map(({ key, type }) => [key, type ? fieldsOf(type, decls) : []]),
    ),
  }
}

import { realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { isPathBelow } from '../../lib/path-containment'

/**
 * Reading a `Client`'s surface module off a hooks module's source, before anything runs, as Claude
 * Code does: each `Client({ … module: "./x.tsx" … })` — JSX compiles to that — must name its module
 * as a string literal, relative to the file it is written in, inside the plugin and naming a file.
 * The literal is rewritten to the module's path under the plugin, which is what the drawing then
 * carries; a `Client` whose module was not read here is refused when it is drawn.
 */

/** `code` with comments and the insides of strings, templates and regexes blanked, same length. */
export function maskCode(code: string): string {
  const out = code.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  // A template's `${…}` is code again: a stack of the code depths it opened.
  const templates: number[] = []
  let depth = 0
  let inTemplate = false
  let last = ''
  let word = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]!
    const n = code[i + 1]
    if (inTemplate) {
      if (c === '`') {
        inTemplate = false
        last = '`'
        i++
      } else if (c === '$' && n === '{') {
        templates.push(depth)
        inTemplate = false
        i += 2
      } else {
        const step = c === '\\' ? 2 : 1
        blank(i, i + step)
        i += step
      }
      continue
    }
    if (c === '/' && (n === '/' || n === '*')) {
      const end = n === '/' ? code.indexOf('\n', i) : code.indexOf('*/', i + 2)
      const stop = end < 0 ? code.length : n === '/' ? end : end + 2
      blank(i, stop)
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      blank(i + 1, j)
      i = j + 1
      last = c
    } else if (c === '`') {
      inTemplate = true
      i++
    } else if (c === '/' && regexMayStart(last, word)) {
      let j = i + 1
      let inClass = false
      while (j < code.length && code[j] !== '\n' && (inClass || code[j] !== '/')) {
        if (code[j] === '\\') j++
        else if (code[j] === '[') inClass = true
        else if (code[j] === ']') inClass = false
        j++
      }
      blank(i + 1, j)
      i = j + 1
      last = '/'
    } else {
      if (c === '{') depth++
      else if (c === '}') {
        if (templates.length && templates.at(-1) === depth) {
          templates.pop()
          inTemplate = true
          i++
          continue
        }
        depth--
      }
      if (/[\w$]/.test(c)) word = /[\w$]/.test(last) ? word + c : c
      if (!/\s/.test(c)) last = c
      i++
    }
  }
  return out.join('')
}

const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'void',
  'yield',
  'await',
  'delete',
  'instanceof',
  'new',
  'throw',
])
function regexMayStart(last: string, word: string): boolean {
  if (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last)) return true
  return /[\w$]/.test(last) && REGEX_AFTER_WORD.has(word)
}

/** One top-level `key: value` of an object literal, by offsets. */
interface Entry {
  key: string
  valueStart: number
  valueEnd: number
}

/** The entries of the object literal opening at `open`, read off the masked code. */
function entriesOf(code: string, masked: string, open: number): Entry[] {
  const entries: Entry[] = []
  let depth = 0
  let start = open + 1
  let colon = -1
  for (let j = open + 1; j < masked.length; j++) {
    const c = masked[j]!
    if ('([{'.includes(c)) depth++
    else if (depth > 0 && ')]}'.includes(c)) depth--
    else if (depth === 0 && c === ':' && colon < 0) colon = j
    else if (depth === 0 && (c === ',' || c === '}')) {
      const key = code.slice(start, colon < 0 ? j : colon).trim()
      entries.push({ key, valueStart: colon < 0 ? -1 : colon + 1, valueEnd: j })
      if (c === '}') return entries
      start = j + 1
      colon = -1
    }
  }
  return entries
}

/** The string a literal value spells, or undefined when it is not one literal. */
function literalOf(value: string, masked: string): string | undefined {
  const quote = value[0]
  if (!quote || !`"'\``.includes(quote) || value.at(-1) !== quote || value.length < 2) return
  // One literal: nothing but blanks between its quotes once masked.
  if (masked.slice(1, -1).trim() !== '') return
  const inner = value.slice(1, -1)
  if (quote === '`') return inner.includes('${') || inner.includes('\\') ? undefined : inner
  try {
    return JSON.parse(
      quote === '"' ? value : `"${inner.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`,
    )
  } catch {
    return undefined
  }
}

export interface ClientSite {
  /** The literal as written, or null when `module` is not one. */
  literal: string | null
  /** What the module was written as, to name in a refusal. */
  written: string
  /** Where the literal stands, to rewrite it. */
  start: number
  end: number
}

const CALL = /\bClient\s*\(|\b[\w$]+\s*\(\s*Client\s*,/g

/** Every `Client` constructed in `code` and the `module` it names. */
export function clientSitesOf(code: string): ClientSite[] {
  const masked = maskCode(code)
  const sites: ClientSite[] = []
  for (const match of masked.matchAll(CALL)) {
    let open = match.index + match[0].length
    while (/\s/.test(masked[open] ?? '')) open++
    const at = { start: match.index, end: open }
    if (masked[open] !== '{') {
      sites.push({ literal: null, written: code.slice(open, open + 40).split('\n')[0]!, ...at })
      continue
    }
    const entry = entriesOf(code, masked, open).find(
      (item) => item.key.replace(/^(["'])(.*)\1$/, '$2') === 'module',
    )
    if (!entry || entry.valueStart < 0) {
      sites.push({ literal: null, written: entry ? 'module' : 'no module', ...at })
      continue
    }
    const raw = code.slice(entry.valueStart, entry.valueEnd)
    const start = entry.valueStart + raw.length - raw.trimStart().length
    const end = entry.valueEnd - (raw.length - raw.trimEnd().length)
    const written = code.slice(start, end)
    const literal = literalOf(written, masked.slice(start, end)) ?? null
    sites.push({ literal, written, start, end })
  }
  return sites
}

const EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mjs']
const JSX_CONFIG = {
  compilerOptions: { jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' },
} as const

/** A `Client` whose module cannot be read off the source: the hooks module does not load. */
export class ClientModuleError extends Error {}

/** Strictly inside the plugin: the plugin's own folder is no module. */
const inside = (root: string, path: string) => isPathBelow(root, path)

function isFileInside(root: string, path: string): boolean {
  try {
    return statSync(path).isFile() && inside(realpathSync(root), realpathSync(path))
  } catch {
    return false
  }
}

/** The line a refusal names: where the written value stands in the source, else the first Client. */
const lineOf = (source: string, written: string) => {
  const exact = written.length > 2 ? source.indexOf(written) : -1
  const index = exact >= 0 ? exact : source.search(/\bClient\b/)
  return index < 0 ? 1 : source.slice(0, index).split('\n').length
}

/**
 * One file of a hooks module with each `Client`'s module rewritten to its path under the plugin
 * (and added to `found`); undefined for a file that constructs no `Client`, which loads as it is.
 */
export function readClientModules(input: {
  source: string
  file: string
  root: string
  loader: 'js' | 'jsx' | 'ts' | 'tsx'
  found?: Set<string>
}): string | undefined {
  if (!/\bClient\b/.test(input.source)) return undefined
  const transpiler = new Bun.Transpiler({ loader: input.loader, tsconfig: JSX_CONFIG })
  const code = transpiler.transformSync(input.source)
  const sites = clientSitesOf(code)
  if (sites.length === 0) return undefined
  // Paths compared as the disk has them: a plugin reached through a symlink is still inside.
  const root = realpathSync(input.root)
  const file = realpathSync(input.file)
  const name = relative(root, file).split(sep).join('/')
  const refuse = (written: string, why: string) =>
    new ClientModuleError(`${name}:${lineOf(input.source, written)}: a Client's module ${why}`)
  let rewritten = code
  for (const site of [...sites].reverse()) {
    const literal = site.literal
    if (literal === null)
      throw refuse(site.written, `must be a string literal relative to this file (${site.written})`)
    if (!/^\.\.?\//.test(literal) || !EXTENSIONS.some((ext) => literal.endsWith(ext)))
      throw refuse(literal, `${literal} is not a ./ path to a .tsx, .jsx, .ts, .js or .mjs file`)
    const path = resolve(dirname(file), literal)
    if (!inside(root, path) || !isFileInside(root, path))
      throw refuse(literal, `${literal} names no file inside the plugin`)
    const module = relative(root, path).split(sep).join('/')
    input.found?.add(module)
    rewritten = rewritten.slice(0, site.start) + JSON.stringify(module) + rewritten.slice(site.end)
  }
  return rewritten
}

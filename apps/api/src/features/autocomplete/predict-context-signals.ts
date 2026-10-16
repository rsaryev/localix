/** Pure lexical signals for ranking context windows and selecting LSP lookup candidates. */

/** JS/TS/Python keywords + noise tokens excluded from the identifier bag. */
const STOP_WORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'import',
  'export',
  'from',
  'default',
  'class',
  'interface',
  'type',
  'enum',
  'extends',
  'implements',
  'new',
  'this',
  'super',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'async',
  'await',
  'yield',
  'void',
  'null',
  'undefined',
  'true',
  'false',
  'typeof',
  'instanceof',
  'in',
  'of',
  'as',
  'is',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'get',
  'set',
  'def',
  'self',
  'None',
  'True',
  'False',
  'and',
  'or',
  'not',
  'with',
  'lambda',
  'pass',
  'elif',
  'string',
  'number',
  'boolean',
])

/** Minimum identifier length kept (drops `i`, `x`, `fn`, …). */
const MIN_IDENT_LEN = 3
/** Hard cap on the identifier bag extracted from any one text (keeps ranking O(1)-ish). */
const MAX_IDENTS = 400

/**
 * Extract the significant identifier bag from a piece of code — word tokens, stop-words
 * and very short tokens dropped, deduped, capped. The lexical ranker and the
 * LSP-symbol picker both use this bag. Pure.
 */
export function extractIdentifiers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // Letters of ANY script: a chat draft or a comment is not ASCII, and an ASCII-only class gave
  // such a draft an empty bag, so every linked resource ranked by position and excerpted its head.
  const re = /[\p{L}_$][\p{L}\p{N}_$]*/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tok = m[0]
    if (tok.length < MIN_IDENT_LEN || STOP_WORDS.has(tok)) continue
    if (seen.has(tok)) continue
    seen.add(tok)
    out.push(tok)
    if (out.length >= MAX_IDENTS) break
  }
  return out
}

/**
 * The identifier bag on the lines within `± radius` of the cursor — the query the
 * relevance ranking scores related windows against. `cursorLine` is 1-based. Pure.
 */
export function symbolsNearCursor(content: string, cursorLine: number, radius = 3): Set<string> {
  const lines = content.split('\n')
  const start = Math.max(0, cursorLine - 1 - radius)
  const end = Math.min(lines.length, cursorLine - 1 + radius + 1)
  return new Set(extractIdentifiers(lines.slice(start, end).join('\n')))
}

/**
 * An identifier that appears near the cursor, WITH its position — the candidate set
 * the service resolves LSP definitions for. Candidates come from a few lines around
 * the cursor, closest-first. 0-based line/character (LSP coordinates). Pure.
 */
export interface CursorIdentifier {
  name: string
  line: number
  character: number
}

/**
 * Identifiers on the lines within `± radius` of the cursor, deduped by name (first
 * occurrence kept), ordered by proximity to the cursor line, capped at `max`. These
 * are the symbols worth a bounded LSP definition lookup. `cursorLine` is 1-based.
 */
export function identifiersForLspLookup(
  content: string,
  cursorLine: number,
  radius = 3,
  max = 6,
): CursorIdentifier[] {
  const lines = content.split('\n')
  const from = Math.max(0, cursorLine - 1 - radius)
  const to = Math.min(lines.length, cursorLine - 1 + radius + 1)
  const found: CursorIdentifier[] = []
  const seen = new Set<string>()
  for (let ln = from; ln < to; ln++) {
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(lines[ln])) !== null) {
      const name = m[0]
      if (name.length < MIN_IDENT_LEN || STOP_WORDS.has(name) || seen.has(name)) continue
      seen.add(name)
      found.push({ name, line: ln, character: m.index })
    }
  }
  // Closest identifiers first so the bounded lookup favors the active edit region.
  found.sort((a, b) => Math.abs(a.line - (cursorLine - 1)) - Math.abs(b.line - (cursorLine - 1)))
  return found.slice(0, max)
}

/** Strip a path to its basename without extension — the token import-neighbour matching keys on. */
export function baseNameNoExt(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

const SOURCE_EXTS = new Set([
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'json',
  'css',
  'scss',
  'go',
  'rs',
])

/**
 * The module NAME an import specifier resolves to, for matching against a file's
 * `baseNameNoExt`. Handles path specifiers (`./lib/helper` → `helper`, `bar.js` →
 * `bar`) and dotted module paths (python `mypkg.utils` → `utils`). Pure.
 */
function importSpecifierName(spec: string): string {
  const lastPath = spec.split('?')[0].split(/[\\/]/).pop() ?? spec
  const parts = lastPath.split('.').filter(Boolean)
  while (parts.length > 1 && SOURCE_EXTS.has(parts[parts.length - 1])) parts.pop()
  return parts[parts.length - 1] ?? lastPath
}

/**
 * The import/require SPECIFIER basenames a file depends on — a cheap dependency-neighbour
 * signal based only on imports the file literally names, with no project index or git
 * history. Matches ES imports and re-exports, CJS `require`, and Python `from`/`import`
 * statements. Returns the deduped set of basenames (no ext). Pure.
 */
export function parseImportBasenames(content: string): Set<string> {
  const out = new Set<string>()
  const add = (spec: string) => {
    const s = spec.trim()
    if (s) out.add(importSpecifierName(s))
  }
  const patterns: RegExp[] = [
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g, // ES import/re-export
    /import\s*['"]([^'"]+)['"]/g, // side-effect import
    /require\(\s*['"]([^'"]+)['"]\s*\)/g, // CJS require
    /from\s+([\w.]+)\s+import\b/g, // python from x import
    /^\s*import\s+([\w.]+)/gm, // python/plain import x
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) add(m[1])
  }
  return out
}

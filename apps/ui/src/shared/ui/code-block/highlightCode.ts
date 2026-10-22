import { parse, render, tokenize, SugarHigh, type ParseOptions } from 'sugar-high/core'
import * as c from 'sugar-high/lang/c'
import * as cpp from 'sugar-high/lang/cpp'
import * as css from 'sugar-high/lang/css'
import * as go from 'sugar-high/lang/go'
import * as java from 'sugar-high/lang/java'
import * as javascript from 'sugar-high/lang/javascript'
import * as json from 'sugar-high/lang/json'
import * as python from 'sugar-high/lang/python'
import * as rust from 'sugar-high/lang/rust'
import * as typescript from 'sugar-high/lang/typescript'
import { mermaid } from './mermaidGrammar'
import { sql } from './sqlGrammar'

/**
 * The core lexer scans JSX, regex and template literals unless told not to; sugar-high's own
 * registry turns them off for every grammar that is not JavaScript, and so does this one.
 * The grammars come from `sugar-high/lang/*` rather than the `sugar-high` entry, which loads
 * all of its languages.
 */
const notScript = (config: ParseOptions): ParseOptions => ({
  ...config,
  jsx: false,
  regex: false,
  templateStrings: false,
})

const JSON_GRAMMAR = notScript(json)
const C_GRAMMAR = notScript(c)
const CPP_GRAMMAR = notScript(cpp)
const CSS_GRAMMAR = notScript(css)
const GO_GRAMMAR = notScript(go)
const PYTHON_GRAMMAR = notScript(python)
const RUST_GRAMMAR = notScript(rust)
const SQL_GRAMMAR = notScript(sql)
const MERMAID_GRAMMAR = notScript(mermaid)
// The JavaScript grammar's declaration types `tokenize` against an older options shape.
const JAVASCRIPT_GRAMMAR: ParseOptions = {
  tokenize: javascript.tokenize as NonNullable<ParseOptions['tokenize']>,
}

// Close dialects share a grammar (SCSS with CSS, the SQL dialects with one SQL grammar).
const LANGUAGE_OPTIONS: Partial<Record<string, ParseOptions>> = {
  json: JSON_GRAMMAR,
  jsonc: JSON_GRAMMAR,
  c: C_GRAMMAR,
  cpp: CPP_GRAMMAR,
  'c++': CPP_GRAMMAR,
  css: CSS_GRAMMAR,
  scss: CSS_GRAMMAR,
  go: GO_GRAMMAR,
  golang: GO_GRAMMAR,
  java: notScript(java),
  mermaid: MERMAID_GRAMMAR,
  mmd: MERMAID_GRAMMAR,
  py: PYTHON_GRAMMAR,
  python: PYTHON_GRAMMAR,
  rs: RUST_GRAMMAR,
  rust: RUST_GRAMMAR,
  sql: SQL_GRAMMAR,
  clickhouse: SQL_GRAMMAR,
  postgresql: SQL_GRAMMAR,
  postgres: SQL_GRAMMAR,
  mysql: SQL_GRAMMAR,
  sqlite: SQL_GRAMMAR,
  js: JAVASCRIPT_GRAMMAR,
  jsx: JAVASCRIPT_GRAMMAR,
  javascript: JAVASCRIPT_GRAMMAR,
  mjs: JAVASCRIPT_GRAMMAR,
  cjs: JAVASCRIPT_GRAMMAR,
  ts: typescript,
  tsx: typescript,
  typescript,
  mts: typescript,
  cts: typescript,
}

const MAX_HIGHLIGHT_CHARACTERS = 128_000

function escapeHtml(code: string): string {
  return code
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** A whole snippet in the TypeScript grammar, for previews that show a fixed script. */
export function highlightScript(code: string): string {
  return highlightCode(code, 'typescript')
}

/** Whether sugar-high has a grammar for a language — else `highlightCode` returns plain text. */
export function hasHighlightGrammar(language: string): boolean {
  const normalizedLanguage = language.trim().toLowerCase()
  return LANGUAGE_OPTIONS[normalizedLanguage] !== undefined
}

/**
 * Highlight code only when sugar-high has a matching grammar.
 *
 * Coloring an unknown language with some other grammar would color logs, YAML and
 * arbitrary prose as code. Unknown and unlabeled fences remain safe escaped plain
 * text instead.
 */
export function highlightCode(code: string, language?: string): string {
  const normalizedLanguage = language?.trim().toLowerCase() ?? ''
  if (code.length >= MAX_HIGHLIGHT_CHARACTERS) return escapeHtml(code)
  const options = LANGUAGE_OPTIONS[normalizedLanguage]
  return options ? render(parse(code, options)) : escapeHtml(code)
}

/** React surfaces use tokens so file actions remain interactive inside colored strings. */
export function highlightCodeTokens(code: string, language: string) {
  if (code.length >= MAX_HIGHLIGHT_CHARACTERS || !hasHighlightGrammar(language)) return null
  const tokens = tokenize(code, LANGUAGE_OPTIONS[language.trim().toLowerCase()])
  // A tokenizer must never alter the payload that the user reads or copies.
  if (tokens.map(([, text]) => text).join('') !== code) return null
  let start = 0
  return tokens.map(([type, text]) => {
    const token = { text, start, end: start + text.length, kind: SugarHigh.TokenTypes[type] }
    start = token.end
    return token
  })
}

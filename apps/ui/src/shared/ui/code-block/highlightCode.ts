import { highlight, tokenize, SugarHigh } from 'sugar-high'
import { c, css, go, java, python, rust } from 'sugar-high/presets'
import { mermaid } from './mermaidGrammar'
import { sql } from './sqlGrammar'

type HighlightOptions = NonNullable<Parameters<typeof highlight>[1]>

// sugar-high's default grammar is JavaScript/TypeScript/JSX. Select one of its
// language-specific grammars where available; close dialects intentionally share
// a preset (C++ with C, SCSS with CSS).
const LANGUAGE_OPTIONS: Partial<Record<string, HighlightOptions>> = {
  json: {
    keywords: new Set(['true', 'false', 'null']),
    typeKeywords: new Set(),
    onCommentStart: () => 0,
  },
  jsonc: {
    keywords: new Set(['true', 'false', 'null']),
    typeKeywords: new Set(),
  },
  c,
  cpp: c,
  'c++': c,
  css,
  scss: css,
  go,
  golang: go,
  java,
  mermaid,
  mmd: mermaid,
  py: python,
  python,
  rs: rust,
  rust,
  sql,
  clickhouse: sql,
  postgresql: sql,
  postgres: sql,
  mysql: sql,
  sqlite: sql,
}

const JAVASCRIPT_LANGUAGES = new Set([
  'js',
  'jsx',
  'javascript',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'typescript',
  'mts',
  'cts',
])

const MAX_HIGHLIGHT_CHARACTERS = 128_000

function escapeHtml(code: string): string {
  return code
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** Whether sugar-high has a grammar for a language — else `highlightCode` returns plain text. */
export function hasHighlightGrammar(language: string): boolean {
  const normalizedLanguage = language.trim().toLowerCase()
  return (
    LANGUAGE_OPTIONS[normalizedLanguage] !== undefined ||
    JAVASCRIPT_LANGUAGES.has(normalizedLanguage)
  )
}

/**
 * Highlight code only when sugar-high has a matching grammar.
 *
 * Its default grammar is JavaScript, so passing an unknown language would color
 * logs, YAML and arbitrary prose as JS. Unknown and unlabeled fences remain safe
 * escaped plain text instead.
 */
export function highlightCode(code: string, language?: string): string {
  const normalizedLanguage = language?.trim().toLowerCase() ?? ''
  if (code.length >= MAX_HIGHLIGHT_CHARACTERS) return escapeHtml(code)
  const options = LANGUAGE_OPTIONS[normalizedLanguage]
  if (options) return highlight(code, options)
  if (JAVASCRIPT_LANGUAGES.has(normalizedLanguage)) return highlight(code)
  return escapeHtml(code)
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

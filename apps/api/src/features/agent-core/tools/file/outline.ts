import { plural } from '../tool-output'

/**
 * Outline read mode — the token-cheap "signatures only" view of a source file,
 * built from language-server document symbols (NOT regex body-stripping, which
 * loses data like const/array contents). The provider is a narrow injected
 * port; agent-core stays LSP-implementation-agnostic.
 */

/** Structurally matches `LspDocumentSymbol` (features/lsp) — 0-based lines. */
export interface OutlineSymbol {
  name: string
  /** LSP SymbolKind (1–26). */
  kind: number
  line: number
  endLine: number
  detail?: string
  depth: number
}

/** Returns the file's symbols, or null when no language server covers the file. */
export type OutlineProvider = (filePath: string) => Promise<OutlineSymbol[] | null>

/** LSP SymbolKind (1–26) → display name. */
const SYMBOL_KINDS = [
  '',
  'file',
  'module',
  'namespace',
  'package',
  'class',
  'method',
  'property',
  'field',
  'constructor',
  'enum',
  'interface',
  'function',
  'variable',
  'constant',
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'key',
  'null',
  'enum-member',
  'struct',
  'event',
  'operator',
  'type-param',
]

export function symbolKindName(kind: number): string {
  return SYMBOL_KINDS[kind] ?? 'symbol'
}

/**
 * Render a flat depth-tagged symbol list as an indented outline with 1-BASED
 * line spans, so entries pair directly with `read` start_line/end_line.
 */
export function formatOutline(path: string, symbols: OutlineSymbol[]): string {
  const lines = symbols.map((s) => {
    const indent = '  '.repeat(Math.max(0, s.depth))
    const span = s.endLine > s.line ? `L${s.line + 1}-${s.endLine + 1}` : `L${s.line + 1}`
    const detail = s.detail ? `  ${s.detail}` : ''
    return `${indent}${symbolKindName(s.kind)} ${s.name} [${span}]${detail}`
  })
  return [
    `Outline of ${path} — ${plural(symbols.length, 'symbol')} (1-based line spans; read a span with start_line/end_line):`,
    ...lines,
  ].join('\n')
}

/**
 * The graph's vocabulary, shared by the backend that builds it and the view that draws it.
 *
 * Both closed sets are deliberately small. A reference that let its extractors mint node and edge
 * types freely ended with 27 node types and 38 edge types, and every filter, colour and
 * exhaustiveness check had to chase them; the view could no longer say what a kind meant. So a
 * kind is added here, with its meaning, or not at all.
 *
 * Hierarchy lives in the model (`parent`), not in `contains` edges: directory → file → symbol →
 * member is what every view navigates by, and a view that had to re-derive it from edges would
 * disagree with the tools about where a node lives.
 */

export const NODE_KINDS = [
  /** A directory under the project root; the root itself is `dir:.`. */
  'directory',
  /** A source file the extractor understood. */
  'file',
  'class',
  'interface',
  /** A type alias or a non-struct Go type. */
  'type',
  'enum',
  'function',
  /** A function defined on a class or a Go receiver type. */
  'method',
  /**
   * A module-level constant or variable that is not a function (`export const LIMIT = 5`, a Go
   * `var`, a Python module global): what a reference to it in code can open.
   */
  'variable',
  /** A dependency outside the project (`react`, `node:fs`, `fmt`); never has a parent. */
  'package',
] as const
export type NodeKind = (typeof NODE_KINDS)[number]

export const SYMBOL_KINDS = [
  'class',
  'interface',
  'type',
  'enum',
  'function',
  'method',
  'variable',
] as const satisfies readonly NodeKind[]
export type SymbolKind = (typeof SYMBOL_KINDS)[number]

export const EDGE_KINDS = [
  /** A file imports (or re-exports from) another file or a package. File → file | package. */
  'imports',
  /** A call or a construction (`new X()`, `X()` for a Python class). Symbol|file → symbol. */
  'calls',
  /** Class or interface inheritance. Symbol → symbol. */
  'extends',
  /** A class implements an interface. Symbol → symbol. */
  'implements',
] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const LANGUAGES = ['typescript', 'tsx', 'javascript', 'python', 'go'] as const
export type LanguageId = (typeof LANGUAGES)[number]

export interface GraphNode {
  id: string
  kind: NodeKind
  name: string
  /** Project-relative POSIX path: the directory, or the file a file/symbol belongs to. */
  path: string
  /** The containing node's id; null for the root directory and for packages. */
  parent: string | null
  /** 1-based first and last line, for files (1…lines) and symbols. */
  line?: number
  endLine?: number
  /** Visible outside its file (TS `export`, a capitalised Go name, a Python name without `_`). */
  exported?: boolean
  language?: LanguageId
}

export interface GraphEdge {
  source: string
  target: string
  kind: EdgeKind
  /** The 1-based line of the first occurrence in the source's file. */
  line: number
  /** How many occurrences this edge stands for: calls repeat, and one edge carries them all. */
  count: number
}

/**
 * Where, inside a symbol's source, a resolved call is written: the callee token and what it
 * reaches. A code card turns exactly these tokens into links — never a name it would have to
 * re-resolve on its own.
 */
export interface CallSite {
  /** 1-based line and 0-based columns (string indices into the raw line) of the callee token. */
  line: number
  column: number
  endColumn: number
  target: string
}

/** A node plus the counts the view and the tools rank by. */
export interface NodeSummary extends GraphNode {
  /** Edges into this node and everything under it, from outside it. */
  dependents: number
  /** Edges out of this node and everything under it, to outside it. */
  dependencies: number
  /** Files under a directory; symbols in a file; members of a class. */
  size: number
}

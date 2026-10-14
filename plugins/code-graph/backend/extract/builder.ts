import type { Node } from '@vscode/tree-sitter-wasm'
import type { LanguageId, SymbolKind } from '../../shared/model'
import type {
  ExtractedCall,
  ExtractedHeritage,
  ExtractedImport,
  ExtractedSymbol,
  FileExtraction,
} from './types'

export type SyntaxNode = Node

/**
 * Per-file ceilings. A generated or vendored file can hold hundreds of thousands of calls; past
 * these the file still contributes its structure, and the graph stays a map a person can read
 * rather than a dump of one bundle.
 */
export const MAX_SYMBOLS_PER_FILE = 4000
export const MAX_CALLS_PER_FILE = 20000
/** Deeper than this the walk stops descending: a pathological tree must not exhaust the stack. */
export const MAX_DEPTH = 1500

export const lineOf = (node: SyntaxNode) => node.startPosition.row + 1
export const endLineOf = (node: SyntaxNode) => node.endPosition.row + 1

export function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index)
    if (child) children.push(child)
  }
  return children
}

/** Whether an unnamed token (`default`, `type`, `*`) is a direct child of `node`. */
export function hasToken(node: SyntaxNode, token: string): boolean {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child && !child.isNamed && child.type === token) return true
  }
  return false
}

/**
 * Collects one file's facts while a language walker visits its tree. The walkers decide WHAT a
 * node means; this owns the bookkeeping they would otherwise each get slightly wrong: indices,
 * ceilings, and one import per specifier.
 */
export class ExtractionBuilder {
  readonly symbols: ExtractedSymbol[] = []
  readonly imports: ExtractedImport[] = []
  readonly calls: ExtractedCall[] = []
  readonly heritage: ExtractedHeritage[] = []
  packageName?: string

  /** The new symbol's index, or null once the file's ceiling is reached. */
  addSymbol(
    node: SyntaxNode,
    name: string,
    kind: SymbolKind,
    parent: number | null,
    exported: boolean,
    extra: Pick<ExtractedSymbol, 'isDefault' | 'qualifier'> = {},
  ): number | null {
    if (!name || this.symbols.length >= MAX_SYMBOLS_PER_FILE) return null
    this.symbols.push({
      name,
      kind,
      parent,
      line: lineOf(node),
      endLine: endLineOf(node),
      exported,
      ...(extra.isDefault ? { isDefault: true } : {}),
      ...(extra.qualifier ? { qualifier: extra.qualifier } : {}),
    })
    return this.symbols.length - 1
  }

  addImport(entry: ExtractedImport): void {
    if (!entry.specifier) return
    this.imports.push(entry)
  }

  /**
   * Records a call from the NAME node of the callee (`helper` in `ns.helper()`), so the position
   * is the token a reader would click, not the start of a receiver chain on an earlier line.
   */
  addCall(caller: number | null, name: SyntaxNode, receiver?: string, receiverType?: string): void {
    if (!name.text || this.calls.length >= MAX_CALLS_PER_FILE) return
    const sameRow = name.endPosition.row === name.startPosition.row
    this.calls.push({
      caller,
      callee: name.text,
      line: lineOf(name),
      column: name.startPosition.column,
      endColumn: sameRow ? name.endPosition.column : name.startPosition.column + name.text.length,
      ...(receiver ? { receiver } : {}),
      ...(receiverType ? { receiverType } : {}),
    })
  }

  /** Records a class field whose type the source states. */
  addField(owner: number | null, name: string, type: string | null | undefined): void {
    const symbol = owner === null ? undefined : this.symbols[owner]
    if (!symbol || !name || !type) return
    symbol.fields ??= {}
    symbol.fields[name] ??= type
  }

  addHeritage(entry: ExtractedHeritage): void {
    if (entry.name) this.heritage.push(entry)
  }

  /** The walker's facts; `extractFile` adds the name uses (`refs.ts`), which every language shares. */
  build(language: LanguageId, lines: number): Omit<FileExtraction, 'refs'> {
    return {
      language,
      lines,
      symbols: this.symbols,
      imports: this.imports,
      calls: this.calls,
      heritage: this.heritage,
      ...(this.packageName ? { packageName: this.packageName } : {}),
    }
  }
}

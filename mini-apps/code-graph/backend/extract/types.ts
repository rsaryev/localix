import type { LanguageId, SymbolKind } from '../../shared/model'

/**
 * What one file says about itself, before anything is known about any other file.
 *
 * Extraction is split from resolution on purpose. A file's extraction depends only on its bytes,
 * so it is cached by content hash and a one-line edit re-parses one file; which symbol a call
 * reaches depends on EVERY file, so it is recomputed from the cached extractions on each build. A
 * reference that cached resolved cross-file edges per file silently dropped the edges from a
 * re-parsed file into unchanged ones — here there is nothing cross-file to go stale.
 *
 * Names are kept as written (`ns.helper`, `self.save`); the resolver owns what they mean.
 */
export interface FileExtraction {
  language: LanguageId
  lines: number
  symbols: ExtractedSymbol[]
  imports: ExtractedImport[]
  calls: ExtractedCall[]
  heritage: ExtractedHeritage[]
  /** Go only: the declared package name, which import aliases default to. */
  packageName?: string
  /** Every use of a name the resolver may turn into a link (`refs.ts`). */
  refs: ExtractedRef[]
}

/** A name used in code, at its token: `GrammarError`, `LIMIT`, `ns.helper`, `pkg.Type`. */
export interface ExtractedRef {
  name: string
  /** For `ns.helper` / `pkg.Type`: the part before the dot. */
  receiver?: string
  /** 1-based line; 0-based columns as string indices into the line (see ExtractedCall). */
  line: number
  column: number
  endColumn: number
}

export interface ExtractedSymbol {
  name: string
  kind: SymbolKind
  /** Index into `symbols` of the enclosing class/receiver type, or null at file level. */
  parent: number | null
  line: number
  endLine: number
  exported: boolean
  /** TS/JS `export default`: what an `import X from` of this file binds. */
  isDefault?: boolean
  /**
   * The owner's name when the owner is not a symbol of this file: a Go method on a type declared
   * in another file of the package. It qualifies the id (`Server.Start`) without inventing a parent.
   */
  qualifier?: string
  /**
   * A class's fields with a type the source spells out: `db: Database`, `cache = new Cache()`,
   * `constructor(private svc: Service)`, `self.repo = Repo()`, a Go struct field. Field name →
   * type as written (`Database`, `ns.Service`). This is what lets `this.db.query()` reach
   * `Database.query` without a type checker.
   */
  fields?: Record<string, string>
}

export interface ImportBinding {
  /** The name this file uses. */
  local: string
  /** The name in the target module; `*` for a namespace/module binding, `default` for a default. */
  imported: string
}

export interface ExtractedImport {
  /** As written: `./util`, `@scope/pkg/sub`, `..pkg.mod` (Python relative), `example.com/m/x`. */
  specifier: string
  line: number
  bindings: ImportBinding[]
  /** `export … from`: the file re-exports these bindings (`*` re-exports everything). */
  reexport?: boolean
}

export interface ExtractedCall {
  /** Index into `symbols` of the innermost enclosing function or method; null at file level. */
  caller: number | null
  /** The called name: `helper`, or the member in `recv.helper`. */
  callee: string
  /** The receiver as written for a member call: `ns`, `this`, `self`, `util`, `this.db`. */
  receiver?: string
  /**
   * The declared type of the receiver's FIRST segment when the source states it in scope: a typed
   * parameter (`svc: Service`), a `const c = new Client()`, a Go method's receiver. Type as
   * written; the resolver finds the declaration it names.
   */
  receiverType?: string
  /**
   * The callee name token: 1-based line, 0-based columns as string indices into the line —
   * web-tree-sitter parses a JS string as UTF-16, so its columns count code units, not bytes.
   */
  line: number
  column: number
  endColumn: number
}

export interface ExtractedHeritage {
  /** Index into `symbols` of the class or interface declaring it. */
  symbol: number
  kind: 'extends' | 'implements'
  name: string
  /** A qualified base (`mod.Base`, `pkg.Base`): the part before the dot. */
  receiver?: string
  line: number
}

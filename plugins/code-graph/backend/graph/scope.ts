import type { NodeKind } from '../../shared/model'
import type { ModuleTarget } from './modules'
import type { FileRecord, SymbolTables } from './symbols'

/**
 * What a name means inside one file, across files: the lookups every edge resolution goes through.
 *
 * Each lookup either finds the ONE declaration a name refers to or answers null. There is no
 * nearest-match fallback and no global search by name: a map that invents an edge whenever two
 * functions share a name (`get`, `run`, `handle`) looks denser and is quietly wrong, and the
 * resolution rate the view reports is only honest if a miss stays a miss.
 */
export interface Binding {
  target: ModuleTarget
  /** The exported name it binds, `*` for the module itself, `default` for a default export. */
  imported: string
}

export interface FileScope {
  record: FileRecord
  bindings: Map<string, Binding>
  /** Python `from x import *` and TS/JS `export * from`: modules whose names this file sees. */
  stars: ModuleTarget[]
  /** Named re-exports: exported name → where it comes from. */
  reexports: Map<string, Binding>
}

const MAX_HOPS = 6
const TYPE_KINDS = new Set<NodeKind>(['class', 'interface', 'type', 'enum'])

export class Scopes {
  readonly byPath = new Map<string, FileScope>()
  /** Class id → resolved base class/interface ids, filled by the heritage pass. */
  readonly bases = new Map<string, string[]>()

  constructor(
    readonly tables: SymbolTables,
    private readonly kindOf: (id: string) => NodeKind | undefined,
  ) {}

  /** The class, interface or named type a type written in `scope` names (`Db`, `store.S`). */
  typeNamed(scope: FileScope, text: string): string | null {
    const dot = text.lastIndexOf('.')
    const id =
      dot > 0
        ? this.qualified(scope, text.slice(0, dot), text.slice(dot + 1))
        : this.name(scope, text)
    const kind = id ? this.kindOf(id) : undefined
    return id && kind && TYPE_KINDS.has(kind) ? id : null
  }

  /** The type of a class's field (`this.db` → Database), declared on it or on a base. */
  fieldType(owner: string, field: string, hops = 0): string | null {
    if (hops > MAX_HOPS) return null
    const entry = this.tables.fields.get(owner)
    const text = entry?.types[field]
    const scope = entry ? this.byPath.get(entry.path) : undefined
    if (text && scope) return this.typeNamed(scope, text)
    for (const base of this.bases.get(owner) ?? []) {
      const inherited = this.fieldType(base, field, hops + 1)
      if (inherited) return inherited
    }
    return null
  }

  /** A name as written in `scope`'s file: its own declaration, an imported one, a star import's. */
  name(scope: FileScope, name: string): string | null {
    const own = this.declared(scope.record, name)
    if (own) return own
    const binding = scope.bindings.get(name)
    if (binding)
      return binding.imported === '*' ? null : this.exported(binding.target, binding.imported)
    for (const star of scope.stars) {
      const found = this.exported(star, name)
      if (found) return found
    }
    return null
  }

  /** `receiver.name`: a member of an imported module, or of a class the receiver names. */
  qualified(scope: FileScope, receiver: string, name: string): string | null {
    const binding = scope.bindings.get(receiver)
    if (binding?.imported === '*') return this.exported(binding.target, name)
    const owner = this.name(scope, receiver)
    return owner ? this.member(owner, name) : null
  }

  /** A top-level declaration of `name` in the file — or, for Go, anywhere in its package. */
  declared(record: FileRecord, name: string): string | null {
    const here = record.topLevel.get(name)
    if (here?.length === 1 && here[0]) return here[0]
    if (here && here.length > 1) return null
    if (record.extraction.language !== 'go') return null
    const dir = record.path.slice(0, Math.max(record.path.lastIndexOf('/'), 0))
    return this.inDirectory(dir, name, false)
  }

  /** What `target` exports as `name`, following re-exports. */
  exported(target: ModuleTarget, name: string, hops = 0): string | null {
    if (hops > MAX_HOPS || target.kind === 'package') return null
    if (target.kind === 'directory') return this.inDirectory(target.path, name, true)
    const scope = this.byPath.get(target.path)
    if (!scope) return null
    if (name === 'default') {
      const index = scope.record.extraction.symbols.findIndex((s) => s.isDefault)
      if (index >= 0) return scope.record.symbolIds[index] ?? null
    } else {
      const own = this.declared(scope.record, name)
      if (own) return own
    }
    const named = scope.reexports.get(name)
    if (named) {
      return named.imported === '*' ? null : this.exported(named.target, named.imported, hops + 1)
    }
    // Python has no export list: a name a module imported is a name it offers (`pkg/__init__.py`
    // doing `from .core import Client` is how packages publish their API).
    const bound = scope.record.extraction.language === 'python' ? scope.bindings.get(name) : null
    if (bound && bound.imported !== '*')
      return this.exported(bound.target, bound.imported, hops + 1)
    if (name === 'default') return null
    for (const star of scope.stars) {
      const found = this.exported(star, name, hops + 1)
      if (found) return found
    }
    return null
  }

  /** A class's member by name, then its bases', nearest first. */
  member(owner: string, name: string, hops = 0): string | null {
    if (hops > MAX_HOPS) return null
    const own = this.tables.members.get(owner)?.get(name)
    if (own) return own
    for (const base of this.bases.get(owner) ?? []) {
      const inherited = this.member(base, name, hops + 1)
      if (inherited) return inherited
    }
    return null
  }

  private inDirectory(dir: string, name: string, exportedOnly: boolean): string | null {
    let found: string | null = null
    for (const record of this.tables.filesInDir.get(dir) ?? []) {
      const ids = record.topLevel.get(name)
      if (!ids) continue
      if (ids.length > 1 || found) return null
      const index = record.symbolIds.indexOf(ids[0] as string)
      if (exportedOnly && !(record.extraction.symbols[index]?.exported ?? true)) continue
      found = ids[0] ?? null
    }
    return found
  }
}

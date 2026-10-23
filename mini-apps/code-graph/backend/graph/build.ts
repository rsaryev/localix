import { dirId, fileId, packageId } from '../../shared/ids'
import type { EdgeKind, LanguageId } from '../../shared/model'
import type { FileExtraction } from '../extract/types'
import { CodeGraph } from './code-graph'
import type { ProjectConfig } from './modules/config'
import {
  createModuleResolver,
  projectFiles,
  type ModuleResolver,
  type ModuleTarget,
} from './modules'
import { Scopes, type FileScope } from './scope'
import { addStructure, type FileRecord, type SymbolTables } from './symbols'

/**
 * One build: cached extractions in, a frozen graph out. The phases run in dependency order —
 * nodes, then imports (which bind names), then inheritance (which member lookups climb), then
 * calls — and each reads only what the phases before it produced.
 */
export interface GraphStats {
  files: number
  symbols: number
  languages: Partial<Record<LanguageId, number>>
  edges: Record<EdgeKind, number>
  /**
   * Call sites: linked to a project symbol, made into a dependency (`fetch()` from an imported
   * package), or neither. The last group is mostly method calls on values (`items.map()`,
   * `client.send()`) whose type a syntax-only map cannot know — which is why an answer reports
   * all three instead of one "resolved" rate that reads as a verdict on the code.
   */
  calls: { total: number; resolved: number; external: number }
  imports: { total: number; internal: number; external: number; unresolved: number }
}

export function buildGraph(input: {
  rootName: string
  extractions: ReadonlyMap<string, FileExtraction>
  config: ProjectConfig
}): { graph: CodeGraph; stats: GraphStats } {
  const graph = new CodeGraph()
  const tables = addStructure(graph, input.rootName, input.extractions)
  const resolve = createModuleResolver(projectFiles(input.extractions.keys()), input.config)
  const scopes = new Scopes(tables, (id) => graph.nodes.get(id)?.kind)
  const stats: GraphStats = {
    files: tables.files.size,
    symbols: 0,
    languages: {},
    edges: { imports: 0, calls: 0, extends: 0, implements: 0 },
    calls: { total: 0, resolved: 0, external: 0 },
    imports: { total: 0, internal: 0, external: 0, unresolved: 0 },
  }

  for (const record of tables.files.values()) {
    const language = record.extraction.language
    stats.languages[language] = (stats.languages[language] ?? 0) + 1
    stats.symbols += record.symbolIds.length
    scopes.byPath.set(record.path, bindImports(graph, record, tables, resolve, stats))
  }
  attachGoMethods(scopes)
  for (const scope of scopes.byPath.values()) linkHeritage(graph, scopes, scope)
  for (const scope of scopes.byPath.values()) linkCalls(graph, scopes, scope, stats)
  for (const scope of scopes.byPath.values()) linkRefs(graph, scopes, scope)

  graph.freeze()
  for (const edge of graph.edges()) stats.edges[edge.kind] += 1
  return { graph, stats }
}

function bindImports(
  graph: CodeGraph,
  record: FileRecord,
  tables: SymbolTables,
  resolve: ModuleResolver,
  stats: GraphStats,
): FileScope {
  const scope: FileScope = { record, bindings: new Map(), stars: [], reexports: new Map() }
  const { language } = record.extraction
  const edgeTo = (target: ModuleTarget, line: number) => {
    const id =
      target.kind === 'file'
        ? fileId(target.path)
        : target.kind === 'directory'
          ? dirId(target.path)
          : packageId(target.name)
    if (target.kind === 'package') {
      graph.addNode({ id, kind: 'package', name: target.name, path: '', parent: null })
    }
    graph.addEdge(record.id, id, 'imports', line)
  }

  for (const entry of record.extraction.imports) {
    stats.imports.total += 1
    const target = resolve(record.path, language, entry.specifier)
    if (!target) {
      stats.imports.unresolved += 1
      continue
    }
    stats.imports[target.kind === 'package' ? 'external' : 'internal'] += 1
    edgeTo(target, entry.line)
    for (const binding of entry.bindings) {
      if (binding.local === '*') {
        scope.stars.push(target)
        continue
      }
      if (entry.reexport) {
        scope.reexports.set(binding.local, { target, imported: binding.imported })
        continue
      }
      // Python `from pkg import mod` binds a submodule when one exists by that name.
      if (language === 'python' && binding.imported !== '*') {
        const sub = resolve(record.path, language, joinDotted(entry.specifier, binding.imported))
        if (sub && sub.kind !== 'package') {
          edgeTo(sub, entry.line)
          scope.bindings.set(binding.local, { target: sub, imported: '*' })
          continue
        }
      }
      const local =
        binding.local || (language === 'go' ? goPackageName(target, entry.specifier, tables) : '')
      if (local) scope.bindings.set(local, { target, imported: binding.imported })
    }
  }
  return scope
}

const joinDotted = (module: string, name: string) =>
  module.endsWith('.') ? `${module}${name}` : `${module}.${name}`

/**
 * A Go import without an alias binds the package's DECLARED name. For a project package that is
 * read from its files; for an external one the last path segment is the convention (minus the
 * `go-` / `.v2` decorations modules commonly carry).
 */
function goPackageName(target: ModuleTarget, specifier: string, tables: SymbolTables): string {
  if (target.kind === 'directory') {
    const declared = tables.filesInDir.get(target.path)?.find((file) => file.extraction.packageName)
      ?.extraction.packageName
    if (declared) return declared
  }
  return specifier.slice(specifier.lastIndexOf('/') + 1).replace(/^go-|\.v\d+$|-go$/g, '')
}

/** A Go method on a type declared in another file of the package becomes that type's member. */
function attachGoMethods(scopes: Scopes) {
  for (const { record } of scopes.byPath.values()) {
    if (record.extraction.language !== 'go') continue
    record.extraction.symbols.forEach((symbol, index) => {
      if (!symbol.qualifier) return
      const owner = scopes.declared(record, symbol.qualifier)
      const id = record.symbolIds[index]
      if (!owner || !id) return
      let members = scopes.tables.members.get(owner)
      if (!members) {
        members = new Map()
        scopes.tables.members.set(owner, members)
      }
      if (!members.has(symbol.name)) members.set(symbol.name, id)
    })
  }
}

const TYPES = new Set(['class', 'interface', 'type'])

function linkHeritage(graph: CodeGraph, scopes: Scopes, scope: FileScope) {
  const { record } = scope
  for (const entry of record.extraction.heritage) {
    const owner = record.symbolIds[entry.symbol]
    const target = entry.receiver
      ? scopes.qualified(scope, entry.receiver, entry.name)
      : scopes.name(scope, entry.name)
    if (!owner || !target || !TYPES.has(graph.nodes.get(target)?.kind ?? '')) continue
    graph.addEdge(owner, target, entry.kind, entry.line)
    const bases = scopes.bases.get(owner)
    if (bases) bases.push(target)
    else scopes.bases.set(owner, [target])
  }
}

const SELF = new Set(['this', 'self', 'cls'])
const CALLABLE = new Set(['function', 'method', 'class'])

function linkCalls(graph: CodeGraph, scopes: Scopes, scope: FileScope, stats: GraphStats) {
  const { record } = scope
  for (const call of record.extraction.calls) {
    stats.calls.total += 1
    const source = call.caller === null ? record.id : (record.symbolIds[call.caller] ?? record.id)
    const target = callTarget(scopes, scope, call)
    if (!target || !CALLABLE.has(graph.nodes.get(target)?.kind ?? '')) {
      const head = (call.receiverType ?? call.receiver ?? call.callee).split('.')[0] ?? ''
      if (scope.bindings.get(head)?.target.kind === 'package') stats.calls.external += 1
      continue
    }
    stats.calls.resolved += 1
    graph.addEdge(source, target, 'calls', call.line)
    graph.addCallSite(source, {
      line: call.line,
      column: call.column,
      endColumn: call.endColumn,
      target,
    })
  }
}

/**
 * Name uses that reach a project declaration, kept as places a code card can link — go-to-
 * definition for types, constants and imported names. Not edges: a type named in an annotation
 * is not a dependency the map should draw, and the map's counts stay about imports and calls.
 */
function linkRefs(graph: CodeGraph, scopes: Scopes, scope: FileScope) {
  const { record } = scope
  for (const ref of record.extraction.refs) {
    const target = ref.receiver
      ? scopes.qualified(scope, ref.receiver, ref.name)
      : scopes.name(scope, ref.name)
    if (!target) continue
    graph.addRefSite(record.id, {
      line: ref.line,
      column: ref.column,
      endColumn: ref.endColumn,
      target,
    })
  }
}

/**
 * What one call site reaches. A bare name resolves in the file's scope. A member call starts from
 * the receiver's first segment — the enclosing class for `this`/`self`, the stated type of a typed
 * variable — and walks typed fields for the rest (`this.db.query` → Database.query). A receiver
 * with no stated type is tried as a module or a class name (`ns.helper()`, `Client.create()`).
 */
function callTarget(
  scopes: Scopes,
  scope: FileScope,
  call: FileScope['record']['extraction']['calls'][number],
): string | null {
  const { record } = scope
  if (call.receiver === undefined) return scopes.name(scope, call.callee)
  if (call.receiver === '?') return null
  const [head = '', ...path] = call.receiver.split('.')
  if (head === 'super' && path.length === 0) {
    const owner = enclosingClass(scopes, record, call.caller)
    for (const base of owner ? (scopes.bases.get(owner) ?? []) : []) {
      const found = scopes.member(base, call.callee)
      if (found) return found
    }
    return null
  }
  let owner: string | null = SELF.has(head)
    ? enclosingClass(scopes, record, call.caller)
    : call.receiverType
      ? scopes.typeNamed(scope, call.receiverType)
      : null
  if (!owner) return SELF.has(head) ? null : scopes.qualified(scope, call.receiver, call.callee)
  for (const field of path) {
    owner = scopes.fieldType(owner, field)
    if (!owner) return null
  }
  return scopes.member(owner, call.callee)
}

/** The class a call's enclosing method belongs to (or the class itself, for field initialisers). */
function enclosingClass(scopes: Scopes, record: FileRecord, caller: number | null): string | null {
  if (caller === null) return null
  const symbol = record.extraction.symbols[caller]
  if (!symbol) return null
  if (symbol.kind === 'class') return record.symbolIds[caller] ?? null
  if (symbol.parent !== null) return record.symbolIds[symbol.parent] ?? null
  return symbol.qualifier ? scopes.declared(record, symbol.qualifier) : null
}

import { dirId, fileId, parentPath, ROOT_DIR_ID, symbolId } from '../../shared/ids'
import type { FileExtraction } from '../extract/types'
import type { CodeGraph } from './code-graph'

/**
 * The node phase of a build: every directory, file and symbol gets its node and id, and the lookup
 * tables the linker resolves names through are filled. Nothing here reads another file's content,
 * so the ids a file produces depend on that file alone.
 */
export interface FileRecord {
  path: string
  id: string
  extraction: FileExtraction
  /** Symbol index → node id. */
  symbolIds: string[]
  /** Top-level symbol name → node ids, in source order. */
  topLevel: Map<string, string[]>
}

export interface SymbolTables {
  files: Map<string, FileRecord>
  /** Class or interface id → member name → member id. */
  members: Map<string, Map<string, string>>
  /** A directory's files, for Go packages and Python namespace packages. */
  filesInDir: Map<string, FileRecord[]>
  /** Class id → its typed fields, and the file whose names those types are written in. */
  fields: Map<string, { types: Record<string, string>; path: string }>
}

export function addStructure(
  graph: CodeGraph,
  rootName: string,
  extractions: ReadonlyMap<string, FileExtraction>,
): SymbolTables {
  const tables: SymbolTables = {
    files: new Map(),
    members: new Map(),
    filesInDir: new Map(),
    fields: new Map(),
  }
  graph.addNode({ id: ROOT_DIR_ID, kind: 'directory', name: rootName, path: '', parent: null })

  for (const [path, extraction] of extractions) {
    const dir = parentPath(path)
    addDirectories(graph, dir)
    const id = fileId(path)
    graph.addNode({
      id,
      kind: 'file',
      name: path.slice(dir ? dir.length + 1 : 0),
      path,
      parent: dirId(dir),
      line: 1,
      endLine: extraction.lines,
      language: extraction.language,
    })
    const record: FileRecord = { path, id, extraction, symbolIds: [], topLevel: new Map() }
    addSymbols(graph, record, tables)
    tables.files.set(path, record)
    const siblings = tables.filesInDir.get(dir)
    if (siblings) siblings.push(record)
    else tables.filesInDir.set(dir, [record])
  }
  return tables
}

function addDirectories(graph: CodeGraph, dir: string) {
  const missing: string[] = []
  for (let at = dir; at && !graph.nodes.has(dirId(at)); at = parentPath(at)) missing.push(at)
  for (const path of missing.reverse()) {
    graph.addNode({
      id: dirId(path),
      kind: 'directory',
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      parent: dirId(parentPath(path)),
    })
  }
}

function addSymbols(graph: CodeGraph, record: FileRecord, tables: SymbolTables) {
  const { symbols } = record.extraction
  const qualified: string[] = []
  const seen = new Map<string, number>()
  symbols.forEach((symbol, index) => {
    const owner = symbol.parent === null ? undefined : qualified[symbol.parent]
    const name = owner
      ? `${owner}.${symbol.name}`
      : symbol.qualifier
        ? `${symbol.qualifier}.${symbol.name}`
        : symbol.name
    qualified[index] = name
    const ordinal = seen.get(name) ?? 0
    seen.set(name, ordinal + 1)
    const id = symbolId(record.path, name, ordinal)
    record.symbolIds[index] = id
    const parentId = symbol.parent === null ? record.id : record.symbolIds[symbol.parent]
    graph.addNode({
      id,
      kind: symbol.kind,
      name: symbol.qualifier ? `${symbol.qualifier}.${symbol.name}` : symbol.name,
      path: record.path,
      parent: parentId ?? record.id,
      line: symbol.line,
      endLine: symbol.endLine,
      exported: symbol.exported,
      language: record.extraction.language,
    })
    if (symbol.fields) tables.fields.set(id, { types: symbol.fields, path: record.path })
    if (symbol.parent === null && !symbol.qualifier) {
      const known = record.topLevel.get(symbol.name)
      if (known) known.push(id)
      else record.topLevel.set(symbol.name, [id])
    } else if (parentId && symbol.parent !== null) {
      let members = tables.members.get(parentId)
      if (!members) {
        members = new Map()
        tables.members.set(parentId, members)
      }
      if (!members.has(symbol.name)) members.set(symbol.name, id)
    }
  })
}

import { describe, expect, test } from 'bun:test'
import { extractFile } from '../extract'
import type { FileExtraction } from '../extract/types'
import { buildGraph } from './build'
import { searchNodes } from './search'
import { projectStructure } from './structure'
import { impact, relations, shortestPath } from './traverse'
import { graphView, nodeDetail } from './view'

const sources: Record<string, string> = {
  'src/app/main.ts': "import { handle } from '../api/handler'\nexport function main() { handle() }",
  'src/api/handler.ts': "import { query } from '../db/query'\nexport function handle() { query() }",
  'src/db/query.ts':
    "import { main } from '../app/main'\nexport function query() {}\nexport function unused() { main() }",
  'lib/util.ts': "import { query } from '../src/db/query'\nexport function util() { query() }",
}

async function graph() {
  const extractions = new Map<string, FileExtraction>()
  for (const [path, text] of Object.entries(sources)) {
    extractions.set(path, (await extractFile(path, text)) as FileExtraction)
  }
  return buildGraph({
    rootName: 'demo',
    extractions,
    config: { tsconfigs: [], packages: [], goModules: [] },
  }).graph
}

describe('graphView', () => {
  test('draws directories as containers of tiles and lifts edges to the deepest drawn box', async () => {
    const view = graphView(await graph(), 'dir:src')
    expect(
      view?.nodes.map((n) => `${n.role}:${n.id}${n.group ? ` in ${n.group}` : ''}`).sort(),
    ).toEqual([
      'child:dir:src/api',
      'child:dir:src/app',
      'child:dir:src/db',
      'portal:dir:lib',
      'tile:file:src/api/handler.ts in dir:src/api',
      'tile:file:src/app/main.ts in dir:src/app',
      'tile:file:src/db/query.ts in dir:src/db',
    ])
    // File to file inside the level; the outside code arrives through its portal.
    const edges = view?.edges.map((e) => `${e.source} -> ${e.target} ×${e.count}`).sort()
    expect(edges).toEqual([
      'dir:lib -> file:src/db/query.ts ×2',
      'file:src/api/handler.ts -> file:src/db/query.ts ×2',
      'file:src/app/main.ts -> file:src/api/handler.ts ×2',
      'file:src/db/query.ts -> file:src/app/main.ts ×2',
    ])
    expect(view?.breadcrumb.map((c) => c.name)).toEqual(['demo', 'src'])
  })

  test('a file level shows its symbols', async () => {
    const view = graphView(await graph(), 'file:src/db/query.ts')
    expect(
      view?.nodes
        .filter((n) => n.role === 'child')
        .map((n) => n.name)
        .sort(),
    ).toEqual(['query', 'unused'])
  })

  test('a crowded level stays bounded while omitted files remain searchable and openable', async () => {
    const extractions = new Map<string, FileExtraction>()
    for (let index = 0; index < 70; index++) {
      const path = `src/unit${String(index).padStart(2, '0')}.ts`
      extractions.set(
        path,
        (await extractFile(path, `export const unit${index} = ${index}`)) as FileExtraction,
      )
    }
    const project = buildGraph({
      rootName: 'demo',
      extractions,
      config: { tsconfigs: [], packages: [], goModules: [] },
    }).graph
    const level = graphView(project, 'dir:src')
    expect(level?.nodes.filter((node) => node.role === 'child')).toHaveLength(64)
    expect(level?.truncated).toBe(6)
    expect(searchNodes(project, 'unit69', { kinds: ['file'] })[0]?.node.id).toBe(
      'file:src/unit69.ts',
    )
    expect(graphView(project, 'file:src/unit69.ts')?.scope.id).toBe('file:src/unit69.ts')
  })
})

describe('traversals', () => {
  test('relations roll a file up to files; impact groups transitive dependents by file', async () => {
    const g = await graph()
    const { incoming } = relations(g, 'file:src/db/query.ts')
    expect(incoming.map((r) => `${r.kind} ${r.node.id}`).sort()).toEqual([
      'calls file:lib/util.ts',
      'calls file:src/api/handler.ts',
      'imports file:lib/util.ts',
      'imports file:src/api/handler.ts',
    ])
    const affected = impact(g, 'sym:src/db/query.ts#query', 2).map(
      (e) => `${e.distance} ${e.file.id}`,
    )
    // Nearest first; at equal distance, the file more code depends on first.
    expect(affected).toEqual([
      '1 file:src/api/handler.ts',
      '1 file:lib/util.ts',
      '2 file:src/app/main.ts',
    ])
    expect(nodeDetail(g, 'sym:src/db/query.ts#query')?.impactFiles).toBe(4)
  })

  test('shortest path follows edge direction unless told otherwise', async () => {
    const g = await graph()
    const path = shortestPath(g, 'sym:src/app/main.ts#main', 'sym:src/db/query.ts#query')
    expect(path?.map((s) => s.node.name)).toEqual(['main', 'handle', 'query'])
    expect(shortestPath(g, 'sym:lib/util.ts#util', 'sym:src/api/handler.ts#handle')).toBeNull()
    expect(
      shortestPath(g, 'sym:lib/util.ts#util', 'sym:src/api/handler.ts#handle', {
        undirected: true,
      }),
    ).not.toBeNull()
  })

  test('cycles, hubs and search ranking', async () => {
    const g = await graph()
    const structure = projectStructure(g)
    expect(structure.cycles).toEqual([
      ['file:src/api/handler.ts', 'file:src/app/main.ts', 'file:src/db/query.ts'],
    ])
    expect(structure.hubFiles[0]?.id).toBe('file:src/db/query.ts')
    expect(searchNodes(g, 'query')[0]?.node.id).toBe('sym:src/db/query.ts#query')
    expect(searchNodes(g, 'db/query')[0]?.node.id).toBe('file:src/db/query.ts')
  })
})

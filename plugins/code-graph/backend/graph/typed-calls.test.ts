import { describe, expect, test } from 'bun:test'
import { extractFile } from '../extract'
import type { FileExtraction } from '../extract/types'
import { buildGraph } from './build'

async function callEdges(sources: Record<string, string>, goModule?: string) {
  const extractions = new Map<string, FileExtraction>()
  for (const [path, text] of Object.entries(sources)) {
    const extraction = await extractFile(path, text)
    if (extraction) extractions.set(path, extraction)
  }
  const { graph } = buildGraph({
    rootName: 'demo',
    extractions,
    config: {
      tsconfigs: [],
      packages: [],
      goModules: goModule ? [{ module: goModule, dir: '' }] : [],
    },
  })
  return [...graph.edges()]
    .filter((edge) => edge.kind === 'calls')
    .map((edge) => `${edge.source} -> ${edge.target}`)
    .sort()
}

describe('calls through stated types', () => {
  test('TypeScript: typed parameters, constructed locals, typed fields and interface members', async () => {
    const edges = await callEdges({
      'db.ts': 'export class Db { query() {} }\nexport interface Store { get(): void }',
      'svc.ts': [
        "import { Db, type Store } from './db'",
        'export class Svc {',
        '  private cache = new Db()',
        '  constructor(private readonly db: Db, other: number) {}',
        '  run(store: Store) { this.db.query(); this.cache.query(); store.get(); const d = new Db(); d.query() }',
        '}',
      ].join('\n'),
    })
    expect(edges).toEqual([
      // The field initialiser `new Db()` belongs to the class itself.
      'sym:svc.ts#Svc -> sym:db.ts#Db',
      'sym:svc.ts#Svc.run -> sym:db.ts#Db',
      'sym:svc.ts#Svc.run -> sym:db.ts#Db.query',
      'sym:svc.ts#Svc.run -> sym:db.ts#Store.get',
    ])
  })

  test('Python: typed parameters and fields assigned through self', async () => {
    const edges = await callEdges({
      'repo.py': 'class Repo:\n    def save(self): pass',
      'svc.py': [
        'from repo import Repo',
        'class Svc:',
        '    def __init__(self):',
        '        self.repo = Repo()',
        '    def run(self, other: Repo):',
        '        self.repo.save()',
        '        other.save()',
      ].join('\n'),
    })
    expect(edges).toEqual([
      'sym:svc.py#Svc.__init__ -> sym:repo.py#Repo',
      'sym:svc.py#Svc.run -> sym:repo.py#Repo.save',
    ])
  })

  test('Go: the receiver, typed parameters, struct fields and composite literals', async () => {
    const edges = await callEdges(
      {
        'store/store.go': 'package store\ntype DB struct{}\nfunc (d *DB) Get() {}',
        'svc/svc.go': [
          'package svc',
          'import "example.com/m/store"',
          'type Svc struct { db *store.DB }',
          'func (s *Svc) Run(other *store.DB) { s.db.Get(); other.Get(); x := &store.DB{}; x.Get(); s.help() }',
          'func (s *Svc) help() {}',
        ].join('\n'),
      },
      'example.com/m',
    )
    expect(edges).toEqual([
      'sym:svc/svc.go#Svc.Run -> sym:store/store.go#DB.Get',
      'sym:svc/svc.go#Svc.Run -> sym:svc/svc.go#Svc.help',
    ])
  })

  test('an untyped receiver still links nowhere', async () => {
    const edges = await callEdges({
      'a.ts': 'export class A { go() {} }\nexport function run(x) { x.go() }',
    })
    expect(edges).toEqual([])
  })
})

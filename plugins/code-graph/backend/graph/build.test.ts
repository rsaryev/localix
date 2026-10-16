import { describe, expect, test } from 'bun:test'
import { extractFile } from '../extract'
import type { FileExtraction } from '../extract/types'
import { buildGraph } from './build'
import type { ProjectConfig } from './modules/config'

async function build(sources: Record<string, string>, config: Partial<ProjectConfig> = {}) {
  const extractions = new Map<string, FileExtraction>()
  for (const [path, text] of Object.entries(sources)) {
    const extraction = await extractFile(path, text)
    if (extraction) extractions.set(path, extraction)
  }
  return buildGraph({
    rootName: 'demo',
    extractions,
    config: { tsconfigs: [], packages: [], goModules: [], ...config },
  })
}

const edgesOf = (graph: Awaited<ReturnType<typeof build>>['graph'], kind: string) =>
  [...graph.edges()]
    .filter((edge) => edge.kind === kind)
    .map((edge) => `${edge.source} -> ${edge.target}`)
    .sort()

describe('buildGraph (TypeScript)', () => {
  test('aliases, workspace packages and barrels resolve to the declaring file', async () => {
    const { graph, stats } = await build(
      {
        'app/src/main.ts': [
          "import { Client } from '~/client'",
          "import { helper } from '@acme/core'",
          "import { util as u } from '@acme/core/util'",
          "import React from 'react'",
          'export function main() { new Client().send(); helper(); u(); React.x() }',
        ].join('\n'),
        'app/src/client.ts': [
          "import { Base } from './base'",
          'export class Client extends Base { send() { this.log(); this.open() } }',
        ].join('\n'),
        'app/src/base.ts': 'export class Base { log() {} open() { this.log() } }',
        'packages/core/src/index.ts': "export * from './helpers'",
        'packages/core/src/helpers.ts': 'export const helper = () => 1',
        'packages/core/src/util.ts': 'export function util() {}',
      },
      {
        tsconfigs: [
          {
            dir: 'app',
            baseUrl: 'app',
            baseUrlDeclared: false,
            paths: [{ pattern: '~/*', targets: ['src/*'] }],
          },
        ],
        packages: [
          {
            name: '@acme/core',
            dir: 'packages/core',
            entries: new Map([['.', 'packages/core/dist/index.js']]),
          },
        ],
      },
    )
    expect(edgesOf(graph, 'imports')).toEqual([
      'file:app/src/client.ts -> file:app/src/base.ts',
      'file:app/src/main.ts -> file:app/src/client.ts',
      'file:app/src/main.ts -> file:packages/core/src/index.ts',
      'file:app/src/main.ts -> file:packages/core/src/util.ts',
      'file:app/src/main.ts -> pkg:react',
      'file:packages/core/src/index.ts -> file:packages/core/src/helpers.ts',
    ])
    expect(edgesOf(graph, 'calls')).toEqual([
      // `this.log()` climbs to the base class; `this.open()` too.
      'sym:app/src/base.ts#Base.open -> sym:app/src/base.ts#Base.log',
      'sym:app/src/client.ts#Client.send -> sym:app/src/base.ts#Base.log',
      'sym:app/src/client.ts#Client.send -> sym:app/src/base.ts#Base.open',
      'sym:app/src/main.ts#main -> sym:app/src/client.ts#Client',
      // Through the barrel's `export *` to the declaring file.
      'sym:app/src/main.ts#main -> sym:packages/core/src/helpers.ts#helper',
      'sym:app/src/main.ts#main -> sym:packages/core/src/util.ts#util',
    ])
    expect(edgesOf(graph, 'extends')).toEqual([
      'sym:app/src/client.ts#Client -> sym:app/src/base.ts#Base',
    ])
    // `.send()` on an expression stays unresolved and `React.x()` goes into a package: never guessed.
    expect(stats.calls).toEqual({ total: 8, resolved: 6, external: 1 })
    expect(stats.imports).toEqual({ total: 6, internal: 5, external: 1, unresolved: 0 })
  })

  test('a name declared twice is ambiguous and links nowhere', async () => {
    const { graph } = await build({
      'a.ts': "import { dup } from './b'\nexport function run() { dup() }",
      'b.ts': 'export function dup() {}\nexport function dup() {}',
    })
    expect(edgesOf(graph, 'calls')).toEqual([])
  })

  test('rolled-up counts only count edges that cross a node boundary', async () => {
    const { graph } = await build({
      'src/a/one.ts':
        "import { two } from './two'\nimport { x } from '../b/x'\nexport function one() { two(); x() }",
      'src/a/two.ts': 'export function two() {}',
      'src/b/x.ts': 'export function x() {}',
    })
    const a = graph.summary('dir:src/a')
    expect(a).toMatchObject({ dependencies: 2, dependents: 0, size: 2 })
    expect(graph.summary('dir:src/b')).toMatchObject({ dependents: 2, dependencies: 0 })
    expect(graph.summary('dir:src')).toMatchObject({ dependents: 0, dependencies: 0, size: 3 })
  })
})

describe('buildGraph (Python, Go)', () => {
  test('Python packages, submodule imports, __init__ re-exports and self calls', async () => {
    const { graph } = await build({
      'pkg/__init__.py': 'from .core import Client',
      'pkg/core.py':
        'class Client:\n    def send(self):\n        self.close()\n    def close(self): pass',
      'pkg/tools/__init__.py': '',
      'pkg/tools/fmt.py': 'def pretty(): pass',
      'main.py': [
        'from pkg import Client',
        'from pkg.tools import fmt',
        'import json',
        'def run():',
        '    Client().send()',
        '    fmt.pretty()',
        '    json.dumps()',
      ].join('\n'),
    })
    expect(edgesOf(graph, 'calls')).toEqual([
      // Through `pkg/__init__.py`, which publishes `Client` by importing it.
      'sym:main.py#run -> sym:pkg/core.py#Client',
      'sym:main.py#run -> sym:pkg/tools/fmt.py#pretty',
      'sym:pkg/core.py#Client.send -> sym:pkg/core.py#Client.close',
    ])
    expect(edgesOf(graph, 'imports')).toContain('file:main.py -> file:pkg/tools/fmt.py')
    expect(edgesOf(graph, 'imports')).toContain('file:main.py -> pkg:json')
  })

  test('Go packages are directories; methods in other files join their type', async () => {
    const { graph } = await build(
      {
        'go.mod': '',
        'cmd/main.go':
          'package main\nimport "example.com/m/internal/store"\nfunc main() { store.Open(); local() }\nfunc local() {}',
        'internal/store/store.go':
          'package store\ntype DB struct{}\nfunc Open() *DB { return nil }',
        'internal/store/query.go':
          'package store\nfunc (d *DB) Query() {}\nfunc helper() { Open() }',
      },
      { goModules: [{ module: 'example.com/m', dir: '' }] },
    )
    expect(edgesOf(graph, 'imports')).toEqual(['file:cmd/main.go -> dir:internal/store'])
    expect(edgesOf(graph, 'calls')).toEqual([
      'sym:cmd/main.go#main -> sym:cmd/main.go#local',
      'sym:cmd/main.go#main -> sym:internal/store/store.go#Open',
      'sym:internal/store/query.go#helper -> sym:internal/store/store.go#Open',
    ])
    expect(graph.nodes.get('sym:internal/store/query.go#DB.Query')?.name).toBe('DB.Query')
  })
})

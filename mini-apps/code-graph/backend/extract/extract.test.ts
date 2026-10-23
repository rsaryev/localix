import { describe, expect, test } from 'bun:test'
import { extractFile, languageOf } from './index'

const typescript = `import D, { a as b, c } from './x'
import * as ns from '@s/p/sub'
export * from './y'
export { z as w } from './z'
const r = require('./r')
export default class Foo extends Bar implements I, J {
  m() { this.n(); ns.f(); new Q(); function inner() { b() } }
  private n = () => 1
}
export interface I extends K {}
export const g = async () => { b() }
function h() { return D() }
export { h }
`

describe('extractFile (TypeScript)', () => {
  test('imports keep their bindings, re-exports are marked, require is an import', async () => {
    const out = await extractFile('src/a.ts', typescript)
    expect(out?.imports).toEqual([
      {
        specifier: './x',
        line: 1,
        bindings: [
          { local: 'D', imported: 'default' },
          { local: 'b', imported: 'a' },
          { local: 'c', imported: 'c' },
        ],
      },
      { specifier: '@s/p/sub', line: 2, bindings: [{ local: 'ns', imported: '*' }] },
      { specifier: './y', line: 3, bindings: [{ local: '*', imported: '*' }], reexport: true },
      { specifier: './z', line: 4, bindings: [{ local: 'w', imported: 'z' }], reexport: true },
      { specifier: './r', line: 5, bindings: [{ local: 'r', imported: '*' }] },
    ])
  })

  test('module-level declarations and members are symbols; nested functions are not', async () => {
    const out = await extractFile('src/a.ts', typescript)
    const symbols = out?.symbols.map((s) => [s.name, s.kind, s.parent, s.exported, !!s.isDefault])
    expect(symbols).toEqual([
      ['Foo', 'class', null, true, true],
      ['m', 'method', 0, false, false],
      ['n', 'method', 0, false, false],
      ['I', 'interface', null, true, false],
      ['g', 'function', null, true, false],
      // `export { h }` after the declaration still exports it.
      ['h', 'function', null, true, false],
    ])
  })

  test('calls are attributed to the enclosing symbol, including from nested functions', async () => {
    const out = await extractFile('src/a.ts', typescript)
    expect(out?.calls.map((c) => [c.caller, c.receiver ?? '', c.callee])).toEqual([
      [1, 'this', 'n'],
      [1, 'ns', 'f'],
      [1, '', 'Q'],
      [1, '', 'b'],
      [4, '', 'b'],
      [5, '', 'D'],
    ])
  })

  test('heritage records extends and implements with their lines', async () => {
    const out = await extractFile('src/a.ts', typescript)
    expect(out?.heritage.map((h) => [h.symbol, h.kind, h.name])).toEqual([
      [0, 'extends', 'Bar'],
      [0, 'implements', 'I'],
      [0, 'implements', 'J'],
      [3, 'extends', 'K'],
    ])
  })
})

describe('extractFile (JavaScript, Python, Go)', () => {
  test('JavaScript destructured require and bare class heritage', async () => {
    const out = await extractFile(
      'lib/a.js',
      "const { a, b: c } = require('./y')\nclass A extends B.C { m() {} }\nexport default function () { a() }\n",
    )
    expect(out?.imports[0]?.bindings).toEqual([
      { local: 'a', imported: 'a' },
      { local: 'c', imported: 'b' },
    ])
    expect(out?.heritage).toEqual([
      { symbol: 0, kind: 'extends', name: 'C', receiver: 'B', line: 2 },
    ])
    expect(out?.symbols.at(-1)).toMatchObject({ name: 'default', isDefault: true, exported: true })
    // The callee token's own position: what the code card makes clickable.
    expect(out?.calls).toEqual([{ caller: 2, callee: 'a', line: 3, column: 29, endColumn: 30 }])
  })

  test('Python imports, methods, self calls and bases', async () => {
    const out = await extractFile(
      'pkg/mod.py',
      [
        'import os.path as osp, json',
        'from ..pkg.mod import A as B, c',
        'from x import *',
        'class Foo(Base, m.Mixin):',
        '    def meth(self):',
        '        self.other(); osp.join(); B()',
        'def _private(): pass',
      ].join('\n'),
    )
    expect(out?.imports.map((i) => [i.specifier, i.bindings])).toEqual([
      ['os.path', [{ local: 'osp', imported: '*' }]],
      ['json', [{ local: 'json', imported: '*' }]],
      [
        '..pkg.mod',
        [
          { local: 'B', imported: 'A' },
          { local: 'c', imported: 'c' },
        ],
      ],
      ['x', [{ local: '*', imported: '*' }]],
    ])
    expect(out?.symbols.map((s) => [s.name, s.kind, s.parent, s.exported])).toEqual([
      ['Foo', 'class', null, true],
      ['meth', 'method', 0, true],
      ['_private', 'function', null, false],
    ])
    expect(out?.calls.map((c) => [c.receiver ?? '', c.callee])).toEqual([
      ['self', 'other'],
      ['osp', 'join'],
      ['', 'B'],
    ])
    expect(out?.heritage.map((h) => [h.name, h.receiver])).toEqual([
      ['Base', undefined],
      ['Mixin', 'm'],
    ])
  })

  test('Go methods attach to a type in the same file, or keep it as a qualifier', async () => {
    const out = await extractFile(
      'cmd/main.go',
      [
        'package main',
        'import (',
        '  "fmt"',
        '  str "strings"',
        ')',
        'func (s *S) M() { s.x(); fmt.Println(); local() }',
        'func (o Other) N() {}',
        'type S struct{ util.Base }',
        'func local() {}',
      ].join('\n'),
    )
    expect(out?.packageName).toBe('main')
    expect(out?.imports.map((i) => [i.specifier, i.bindings[0]?.local])).toEqual([
      ['fmt', ''],
      ['strings', 'str'],
    ])
    expect(out?.symbols.map((s) => [s.name, s.kind, s.parent, s.qualifier])).toEqual([
      ['M', 'method', 2, undefined],
      ['N', 'method', null, 'Other'],
      ['S', 'class', null, undefined],
      ['local', 'function', null, undefined],
    ])
    expect(out?.heritage).toEqual([
      { symbol: 2, kind: 'extends', name: 'Base', receiver: 'util', line: 8 },
    ])
  })

  test('unsupported, minified and oversized files are not read', async () => {
    expect(languageOf('README.md')).toBeNull()
    expect(languageOf('dist/app.min.js')).toBeNull()
    expect(await extractFile('a.ts', `const x = 1;${' '.repeat(3000)}`)).toBeNull()
  })
})

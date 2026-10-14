import { describe, expect, test } from 'bun:test'
import { runtimeImports } from './runtime-imports'

describe('runtime module specifiers', () => {
  test('invalid syntax fails with the inspected filename', () => {
    expect(() => runtimeImports('import {', 'broken.ts')).toThrow('broken.ts')
  })

  test('TSX files are parsed using their real extension', () => {
    expect(runtimeImports('const view = <div />; import("./lazy")', 'view.tsx')).toEqual(['./lazy'])
  })

  test('a side-effect import does not absorb a later type-only declaration', () => {
    expect(runtimeImports("import './setup'\nimport type { Shape } from './types'")).toEqual([
      './setup',
    ])
  })

  test('declaration-level types erase, including re-exports and import type queries', () => {
    expect(
      runtimeImports(
        [
          "import type Default from './default'",
          "import type { Shape } from './shape'",
          "export type { Shape } from './shape'",
          "export type * from './types'",
          "type Result = import('./query').Result",
        ].join('\n'),
      ),
    ).toEqual([])
  })

  test('inline type specifiers may retain module evaluation under verbatimModuleSyntax', () => {
    expect(runtimeImports("import { type Shape } from './imports'")).toEqual(['./imports'])
    expect(runtimeImports("export { type Shape } from './exports'")).toEqual(['./exports'])
  })

  test('comments and string contents are not module declarations', () => {
    expect(
      runtimeImports(
        [
          '// import("node:fs")',
          '/* export * from "node:path" */',
          'const example = \'import("node:net")\'',
          'const template = `\nimport "node:os"\n`',
          'const pattern = /import\\("node:dns"\\)/',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  test('dynamic imports support comments, options, and nested expressions', () => {
    expect(
      runtimeImports('const load = () => import(/* chunk */ "./lazy", { with: { type: "json" } })'),
    ).toEqual(['./lazy'])
  })

  test('static template imports resolve, while computed imports stay unknown', () => {
    expect(runtimeImports('const load = () => import(`./lazy`)')).toEqual(['./lazy'])
    expect(runtimeImports('const load = (name: string) => import(`./${name}`)')).toEqual([])
  })

  test('escaped module specifiers are decoded', () => {
    expect(runtimeImports('import "node:\\x66s"')).toEqual(['node:fs'])
  })

  test('runtime edges include aliases, stars, and imports with attributes', () => {
    const source = [
      "import Default, { type Shape, value as local } from './mixed'",
      "export { local as renamed } from './named'",
      "export * as all from './namespace'",
      "export * from './star'",
      'import data from "./data.json" with { type: "json" }',
    ].join('\n')
    expect(runtimeImports(source)).toEqual([
      './mixed',
      './named',
      './namespace',
      './star',
      './data.json',
    ])
  })

  test('each runtime specifier is returned once', () => {
    expect(runtimeImports("import './same'\nexport * from './same'\nimport('./same')")).toEqual([
      './same',
    ])
  })
})

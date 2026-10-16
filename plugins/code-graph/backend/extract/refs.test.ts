import { describe, expect, test } from 'bun:test'
import { extractFile } from './index'

const refsOf = async (path: string, text: string) =>
  ((await extractFile(path, text))?.refs ?? []).map((ref) =>
    ref.receiver ? `${ref.receiver}.${ref.name}` : ref.name,
  )

describe('collectRefs', () => {
  test('TypeScript: uses of names and types, never declarations or shadowing locals', async () => {
    const refs = await refsOf(
      'a.ts',
      [
        "import { Config, LIMIT, helper } from './b'",
        "import * as ns from './c'",
        'export const MAX: number = LIMIT',
        'export function run(input: Config): Config {',
        '  const helper = () => 1',
        '  const { a, b: renamed } = input',
        '  return ns.make(input, MAX, helper(), a, renamed)',
        '}',
      ].join('\n'),
    )
    // Declarations (`MAX`, `run`) are never uses of themselves; parameters and destructured locals
    // (`input`, `a`, `renamed`) and the local `helper` shadow module names, so none is a link.
    // The receiver `ns` stays: a receiver that names a class (`Client.create`) is a link to it.
    expect(refs).toEqual(['LIMIT', 'Config', 'Config', 'ns.make', 'ns', 'MAX'])
  })

  test('Python: module names and `mod.name`, not parameters, keyword names or attributes of calls', async () => {
    const refs = await refsOf(
      'm.py',
      [
        'import util',
        'from cfg import LIMIT',
        'def run(value: Config, n=LIMIT):',
        '    total = util.clamp(value, limit=LIMIT)',
        '    return build().result + total',
      ].join('\n'),
    )
    // `value`, `n`, `total` are declared; `limit=` is a keyword name; `.result` belongs to a call.
    expect(refs).toEqual(['Config', 'LIMIT', 'util.clamp', 'util', 'LIMIT', 'build'])
  })

  test('Go: package members and types, not the names a declaration introduces', async () => {
    const refs = await refsOf(
      'main.go',
      [
        'package main',
        'import "example.com/m/store"',
        'const Limit = 3',
        'func Run(db *store.DB) int {',
        '  n, err := store.Count(db, Limit)',
        '  return n',
        '}',
      ].join('\n'),
    )
    // `Limit`, `Run`, `db`, `n`, `err` are declared here; `int` stays a use the resolver will not
    // find in the project, so it never becomes a link.
    expect(refs).toEqual(['store.DB', 'int', 'store.Count', 'store', 'Limit'])
  })
})

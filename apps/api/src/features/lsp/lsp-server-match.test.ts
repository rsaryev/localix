import { describe, expect, test } from 'bun:test'
import { matchingLspServers } from './lsp-server-match'

const first = { id: 'first', extensions: ['.ts', '.env'] }
const second = { id: 'second', extensions: ['.ts', '.'] }
const named = {
  id: 'named',
  extensions: [],
  matchesFilename: (base: string) => base === 'Makefile',
}
const servers = [first, second, named]

describe('LSP file matching', () => {
  test.each([
    ['src/main.TS', ['first', 'second']],
    ['C:\\src\\main.TS', ['first', 'second']],
    ['mixed/path\\main.ts', ['first', 'second']],
    ['project/.env', ['first']],
    ['project/name.', ['second']],
    ['project/Makefile', ['named']],
    ['project/makefile', []],
    ['project/main.ts/', []],
    ['project/main.ts\\', []],
    ['', []],
  ])('%s retains extension normalization and exact filename matching', (file, expected) => {
    expect(matchingLspServers(servers, file).map((server) => server.id)).toEqual(expected)
  })

  test('keeps server order and identity, and consults filenames only after an extension miss', () => {
    const names: string[] = []
    const covered = {
      extensions: ['.ts'],
      matchesFilename: () => {
        throw new Error('unnecessary fallback')
      },
    }
    const fallback = {
      extensions: ['.other'],
      matchesFilename: (base: string) => {
        names.push(base)
        return true
      },
    }
    const definitions = [covered, fallback, covered]
    const matched = matchingLspServers(definitions, 'src/MAIN.TS')
    expect(matched).toEqual(definitions)
    expect(matched).not.toBe(definitions)
    expect(matched[0]).toBe(covered)
    expect(matched[1]).toBe(fallback)
    expect(matched[2]).toBe(covered)
    expect(names).toEqual(['MAIN.TS'])
  })
})

import { expect, test } from 'bun:test'
import { createLspDocumentService, type LspServiceDeps } from './service'

function fixture(symbols: unknown[]) {
  const calls: string[] = []
  const deps: LspServiceDeps = {
    lspManager: {
      onUpdate: () => () => {},
      workspaceSymbols: async (root: string, query: string) => {
        calls.push(`${root}:${query}`)
        return symbols
      },
    } as unknown as LspServiceDeps['lspManager'],
    resolveProjectRoot: async () => {
      calls.push('resolve')
      return '/fixture'
    },
    publish: () => {},
    writeFile: async () => ({ hash: 'unused' }),
  }
  return { service: createLspDocumentService(deps), calls, deps }
}

test('workspace symbol search trims before resolving ownership and retains the first duplicate', async () => {
  const first = { name: 'Symbol', uri: 'file:///fixture/source.ts', line: 1, character: 2, kind: 1 }
  const { service, calls } = fixture([
    first,
    { ...first, kind: 2, containerName: 'duplicate' },
    { ...first, character: 3 },
    { ...first, uri: 'https://fixture/source.ts' },
  ])
  try {
    expect(await service.workspaceSymbols('user', 'session', '  ')).toEqual([])
    expect(calls).toEqual([])
    expect(await service.workspaceSymbols('user', 'session', '  Symbol  ')).toEqual([
      {
        name: 'Symbol',
        kind: 1,
        containerName: undefined,
        file: '/fixture/source.ts',
        line: 1,
        character: 2,
      },
      {
        name: 'Symbol',
        kind: 1,
        containerName: undefined,
        file: '/fixture/source.ts',
        line: 1,
        character: 3,
      },
    ])
    expect(calls).toEqual(['resolve', '/fixture:Symbol'])
  } finally {
    service.dispose()
  }
})

test('workspace search limits the merged results to the first 200 unique symbols', async () => {
  const symbols = Array.from({ length: 205 }, (_, line) => ({
    name: `Symbol${line}`,
    uri: 'file:///fixture/source.ts',
    line,
    character: 0,
    kind: 1,
  }))
  const { service } = fixture(symbols)
  try {
    const result = await service.workspaceSymbols('user', 'session', 'query')
    expect(result).toHaveLength(200)
    expect(result[0]!.line).toBe(0)
    expect(result.at(-1)!.line).toBe(199)
  } finally {
    service.dispose()
  }
})

import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { dirname, resolve } from 'node:path'
import { assertPositiveControl, scanSources } from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/** Native lifecycle infrastructure cannot depend on an external-format implementation. */
async function externalImports(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (file) => file.endsWith('.test.ts'),
    minFiles: 1,
  })
  return sources.flatMap((source) =>
    [...source.code.matchAll(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)]
      .filter((match) => /(?:^|\/)cc-[^/]+(?:\/|$)/.test(match[1]!))
      .map((match) => `${source.file}: ${match[1]}`),
  )
}

describe('native lifecycle boundary', () => {
  test('no external format imports, including types', async () => {
    expect(await externalImports(dirname(Bun.fileURLToPath(import.meta.url)))).toEqual([])
  })
  test('the shared runtime contract also has no external format imports', async () => {
    const root = resolve(
      dirname(Bun.fileURLToPath(import.meta.url)),
      '../../../../../packages/agent/src/runtime',
    )
    expect(await externalImports(root)).toEqual([])
  })
  test('positive control detects a foreign type dependency', async () => {
    await assertPositiveControl({
      subject: 'foreign lifecycle contract',
      file: 'foreign.ts',
      offender: "import type { CcHookHandler } from '../cc-hooks/contracts'\n",
      scaffold: { 'native.ts': 'export type NativeEvent = string\n' },
      detect: externalImports,
    })
  })
})

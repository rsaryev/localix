import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { bundleHooksModule, clearHooksCopies } from './module-build'
import { runBundle } from './testing/testing-bundle'

const scratch = tempDirPerTest('mods-build', {})

test('each run of one bundle has its own module state', async () => {
  const root = scratch()
  writeTree(root, {
    'hooks/register.tsx': `
      /* @jsx h */
      /* @jsxFrag Fragment */
      import { count } from './count'
      export function register() { return { tree: <>{count()}</> } }
    `,
    'hooks/count.ts': 'let n = 0\nexport const count = () => ++n',
  })
  const code = await bundleHooksModule({ module: join(root, 'hooks/register.tsx'), root })
  const results = [1, 2, 3].map(() => (runBundle(code).register as () => { tree: unknown })().tree)
  expect(results.map((tree) => JSON.stringify(tree))).toEqual([
    expect.stringContaining('[1]'),
    expect.stringContaining('[1]'),
    expect.stringContaining('[1]'),
  ])
})

test('the copies earlier versions wrote to disk are removed', async () => {
  const out = scratch()
  mkdirSync(join(out, 'load-0123456789abcdef'))
  writeFileSync(join(out, 'load-0123456789abcdef', 'hooks-1.cjs'), '')
  writeFileSync(join(out, 'hooks-2.mjs'), '')
  writeFileSync(join(out, 'kept.json'), '{}')
  await clearHooksCopies(out)
  expect(readdirSync(out)).toEqual(['kept.json'])
})

test('a module importing a package is refused at build, naming it', async () => {
  const root = scratch()
  writeTree(root, { 'hooks/register.js': "import x from 'left-pad'\nexport const register = x" })
  await expect(
    bundleHooksModule({ module: join(root, 'hooks/register.js'), root }),
  ).rejects.toThrow('left-pad')
})

test('text that only spells an import is no import: the module builds', async () => {
  const root = scratch()
  writeTree(root, {
    'hooks/register.js': `
      // import(x) and import.meta in a comment
      const pattern = /import\\(x\\)/
      const config = { import: 'x', other: 1 }
      export const register = () => ({
        text: 'use import("x") or import.meta.url ' + pattern.source + config.import,
      })
    `,
  })
  const code = await bundleHooksModule({ module: join(root, 'hooks/register.js'), root })
  expect((runBundle(code).register as () => { text: string })().text).toContain('import(')
})

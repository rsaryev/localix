import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { bundleHooksModule, clearHooksCopies, importHooksModule } from './module-build'

const scratch = tempDirPerTest('mods-build', {})

test('each load imports its own copy, with its own state, however many share the data dir', async () => {
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
  const out = join(root, 'data')
  const results: { tree: unknown }[] = []
  for (const load of ['a-1', 'a-2', 'b-3']) {
    const register = (await importHooksModule(code, out, load)) as unknown as () => {
      tree: unknown
    }
    results.push(register())
  }
  expect(results.map((result) => JSON.stringify(result.tree))).toEqual([
    expect.stringContaining('[1]'),
    expect.stringContaining('[1]'),
    expect.stringContaining('[1]'),
  ])
  await clearHooksCopies(out)
  expect(readdirSync(out)).toEqual([])
})

test('a module importing a package is refused at build, naming it', async () => {
  const root = scratch()
  writeTree(root, { 'hooks/register.js': "import x from 'left-pad'\nexport const register = x" })
  await expect(
    bundleHooksModule({ module: join(root, 'hooks/register.js'), root }),
  ).rejects.toThrow('left-pad')
})

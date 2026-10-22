import { expect, test } from 'bun:test'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { run, tempDirPerTest, writeTree } from '@localixai/testing'

const scratch = tempDirPerTest('mods-build-process', {})

/**
 * Outside the test runner, Bun's resolver keeps the listing of a directory reached through a
 * symlink (macOS's `/var` is one) once it has read it, so a module copy written beside one already
 * imported was "not found" — a mod's second project never started. Each load now gets its own
 * directory; this runs the loads in a plain Bun process, through a symlinked data dir.
 */
test('a plain Bun process imports one load after another from the same data dir', async () => {
  const root = scratch()
  writeTree(root, {
    'hooks/register.js': 'let n = 0\nexport const register = () => ++n',
    'load.ts': `
      import { bundleHooksModule, importHooksModule } from ${JSON.stringify(join(import.meta.dir, 'module-build.ts'))}
      const root = ${JSON.stringify(root)}
      const code = await bundleHooksModule({ module: root + '/hooks/register.js', root })
      const counts = []
      for (const load of ['a-1', 'a-2', 'b-3'])
        counts.push((await importHooksModule(code, root + '/linked/data', load))(() => {}, {}))
      console.log(JSON.stringify(counts))
    `,
  })
  symlinkSync(root, join(root, 'linked'))
  const result = await run(process.execPath, [join(root, 'load.ts')], { timeoutMs: 20_000 })
  expect(result.stderr).not.toContain('Cannot find module')
  expect(result.stdout.trim()).toBe('[1,1,1]')
}, 30_000)

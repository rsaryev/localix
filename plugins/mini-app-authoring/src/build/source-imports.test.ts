import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { tempDirPerTest } from '../testing/temp'

import { assertContainedBuildInputs } from './source-imports'

const scratch = tempDirPerTest('source-imports-')

function write(root: string, file: string, text = '') {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

/** A mini app whose file imports a hoisted package, built from `root` as Bun 1.4 records it. */
function layout() {
  const root = scratch()
  write(root, 'app/ui/view.tsx')
  write(root, 'kit/index.js')
  write(root, 'node_modules/@x/pkg/package.json', '{"name":"@x/pkg"}')
  write(root, 'node_modules/@x/pkg/dist/index.js')
  write(root, 'node_modules/@x/pkg/dist/parse.js')
  return root
}

const input = (imports: { path: string; original?: string }[]) => ({
  bytes: 0,
  imports: imports.map((edge) => ({ ...edge, kind: 'import-statement' as const })),
})

describe('assertContainedBuildInputs', () => {
  test('a package reached through a barrel that is no input of its own is trusted', async () => {
    const root = layout()
    // Bun 1.4 records every path relative to the build's working directory; the package's
    // `dist/index.js` only re-exports, so tree shaking leaves it out of the inputs.
    const metafile = {
      inputs: {
        'app/ui/view.tsx': input([
          { path: 'node_modules/@x/pkg/dist/index.js', original: '@x/pkg' },
        ]),
        'node_modules/@x/pkg/dist/parse.js': input([]),
      },
      outputs: {},
    } as unknown as Bun.BuildMetafile
    await expect(
      assertContainedBuildInputs({
        metafile,
        miniAppDir: join(root, 'app'),
        kitDir: join(root, 'kit'),
        cwd: root,
      }),
    ).resolves.toBeUndefined()
  })

  test('a file outside the mini app that no package import reaches is still refused', async () => {
    const root = layout()
    write(root, 'secret.js')
    const metafile = {
      inputs: {
        'app/ui/view.tsx': input([{ path: 'secret.js', original: '../../secret.js' }]),
        'secret.js': input([]),
      },
      outputs: {},
    } as unknown as Bun.BuildMetafile
    await expect(
      assertContainedBuildInputs({
        metafile,
        miniAppDir: join(root, 'app'),
        kitDir: join(root, 'kit'),
        cwd: root,
      }),
    ).rejects.toThrow(/outside the mini app/)
  })
})

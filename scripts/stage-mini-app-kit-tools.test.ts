import { describe, expect, test } from 'bun:test'
import { join, relative, resolve } from 'node:path'

import { MINI_APP_KIT_INPUTS } from './stage-mini-app-kit.mjs'
import { KIT_TOOLS_ENTRY } from './stage-mini-app-kit-tools.mjs'

const root = join(import.meta.dir, '..')

describe('the kit input list', () => {
  // The kit cache digest and the dev watcher read MINI_APP_KIT_INPUTS; a file the authoring bundle
  // absorbs that is not named there leaves a stale bundle in use after an edit.
  test('names every repository file the authoring bundle is built from', async () => {
    const built = await Bun.build({
      entrypoints: [join(root, KIT_TOOLS_ENTRY)],
      target: 'bun',
      format: 'esm',
      write: false,
      metafile: true,
    })
    expect(built.success).toBe(true)
    const covered = (file: string) =>
      MINI_APP_KIT_INPUTS.some((input) => file === input || file.startsWith(`${input}/`))
    // The metafile names inputs relative to the working directory, which differs between a run
    // from the repository root and one from this package.
    const uncovered = Object.keys(built.metafile?.inputs ?? {})
      .map((file) => relative(root, resolve(file)))
      .filter((file) => !file.includes('node_modules/') && !covered(file))
    expect(uncovered).toEqual([])
  })
})

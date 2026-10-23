import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import {
  MINI_APPS_DIR,
  MINI_APPS_PREFIX,
  PLUGINS_DIR,
  appOfPath,
  bundledFolderOf,
  bundledRoots,
  extensionOfPath,
  miniAppsRoot,
} from './bundled-roots.mjs'

const repoRoot = resolve(import.meta.dir, '../..')

/**
 * The scripts that stage, watch, attribute or package the bundled extensions. Each names the
 * bundled folder through `bundled-roots.mjs`, so renaming it is a change to that module alone.
 */
const ROOT_READERS = [
  'apps/desktop-tauri/scripts/file-associations.mjs',
  'apps/desktop-tauri/scripts/prepare-sidecar.mjs',
  'apps/desktop-tauri/scripts/smoke-bundle.mjs',
  'scripts/architecture/package-rules.ts',
  'scripts/browser-graph.ts',
  'scripts/check-architecture.mjs',
  'scripts/check-public-repo.mjs',
  'scripts/dev-api.mjs',
  'scripts/dev-plugin-watch.mjs',
  'scripts/pre-commit-plan.mjs',
  'scripts/screenshots/workbench-coverage.mjs',
  'scripts/stage-dropins.mjs',
  'scripts/stage-plugin-kit.mjs',
  'scripts/stage-plugin-ui.mjs',
  'scripts/stage-third-party-notices.mjs',
]

/** A quoted bundled folder or a regular expression anchored on it, outside comments. */
const HARD_CODED = /["'`](?:mini-apps|plugins)["'`/]|\^(?:mini-apps|plugins)\\?\//u

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:\\])\/\/.*$/gmu, '$1')

const hardCodedLines = (source: string) =>
  withoutComments(source)
    .split('\n')
    .flatMap((line, index) => (HARD_CODED.test(line) ? [`${index + 1}: ${line.trim()}`] : []))

describe('bundled roots', () => {
  test('a repository path names the bundled mini app it lies in', () => {
    expect(appOfPath(`${MINI_APPS_PREFIX}demo-app/ui/App.tsx`)).toEqual({
      app: 'demo-app',
      rest: 'ui/App.tsx',
    })
    expect(appOfPath(`${MINI_APPS_PREFIX}demo-app\\backend\\index.ts`)).toEqual({
      app: 'demo-app',
      rest: 'backend/index.ts',
    })
    expect(appOfPath(`${MINI_APPS_PREFIX}demo-app/`)).toEqual({ app: 'demo-app', rest: '' })
    expect(appOfPath(`${MINI_APPS_PREFIX}README.md`)).toBeNull()
    expect(appOfPath(MINI_APPS_DIR)).toBeNull()
    expect(appOfPath('apps/ui/src/main.tsx')).toBeNull()
    expect(appOfPath(`packages/${MINI_APPS_PREFIX}demo-app/x.ts`)).toBeNull()
    // A bundled plugin is not a mini app.
    expect(appOfPath(`${PLUGINS_DIR}/workflows/commands/workflows.md`)).toBeNull()
  })

  test('a repository path names the bundled extension, mini app or plugin, it lies in', () => {
    expect(extensionOfPath(`${MINI_APPS_PREFIX}chess/ui/App.tsx`)).toEqual({
      dir: MINI_APPS_DIR,
      app: 'chess',
      rest: 'ui/App.tsx',
    })
    expect(extensionOfPath(`${PLUGINS_DIR}/workflows/commands/workflows.md`)).toEqual({
      dir: PLUGINS_DIR,
      app: 'workflows',
      rest: 'commands/workflows.md',
    })
    expect(extensionOfPath(`${PLUGINS_DIR}/.localix-plugin/marketplace.json`)).toEqual({
      dir: PLUGINS_DIR,
      app: '.localix-plugin',
      rest: 'marketplace.json',
    })
    expect(extensionOfPath('apps/api/src/index.ts')).toBeNull()
  })

  const checkout = tempDirPerTest('bundled-roots', {
    'mini-apps/chess/ui/register.tsx': '',
    'plugins/workflows/commands/workflows.md': '',
  })

  test('an extension is found in whichever bundled folder holds it', () => {
    expect(bundledFolderOf(checkout(), 'chess')).toBe(join(checkout(), MINI_APPS_DIR, 'chess'))
    expect(bundledFolderOf(checkout(), 'workflows')).toBe(
      join(checkout(), PLUGINS_DIR, 'workflows'),
    )
    expect(bundledFolderOf(checkout(), 'missing')).toBeNull()
  })

  test('a checkout bundles mini apps and plugins in folders of their own', () => {
    expect(miniAppsRoot('/repo')).toBe(join('/repo', MINI_APPS_DIR))
    expect(bundledRoots('/repo')).toEqual([
      join('/repo', MINI_APPS_DIR),
      join('/repo', PLUGINS_DIR),
    ])
  })

  test('the detector reports a quoted folder and an anchored pattern', () => {
    expect(hardCodedLines("const dir = join(repoRoot, 'plugins')")).toHaveLength(1)
    expect(hardCodedLines('const glob = `plugins/*/ui/register.tsx`')).toHaveLength(1)
    expect(hardCodedLines('if (/^plugins\\/.*\\/backend\\//.test(path)) {')).toHaveLength(1)
    expect(hardCodedLines("// stages `plugins/` into 'plugins'")).toEqual([])
    expect(hardCodedLines("import x from '../apps/api/src/features/plugins/discovery.ts'")).toEqual(
      [],
    )
  })

  test.each(ROOT_READERS)('%s names the bundled folder only through bundled-roots', (path) => {
    const source = readFileSync(join(repoRoot, path), 'utf8')
    expect(source).toContain('bundled-roots.mjs')
    expect(hardCodedLines(source)).toEqual([])
  })
})

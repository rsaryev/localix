import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  BUNDLED_APPS_DIR,
  BUNDLED_APPS_PREFIX,
  appOfPath,
  bundledAppsRoot,
  pluginOfPath,
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

/** A quoted `plugins` path segment or a regular expression anchored on it, outside comments. */
const HARD_CODED = /["'`]plugins["'`/]|\^plugins\\?\//u

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:\\])\/\/.*$/gmu, '$1')

const hardCodedLines = (source: string) =>
  withoutComments(source)
    .split('\n')
    .flatMap((line, index) => (HARD_CODED.test(line) ? [`${index + 1}: ${line.trim()}`] : []))

describe('bundled roots', () => {
  test('a repository path names the bundled extension it lies in', () => {
    expect(appOfPath(`${BUNDLED_APPS_PREFIX}demo-app/ui/App.tsx`)).toEqual({
      app: 'demo-app',
      rest: 'ui/App.tsx',
    })
    expect(appOfPath(`${BUNDLED_APPS_PREFIX}demo-app\\backend\\index.ts`)).toEqual({
      app: 'demo-app',
      rest: 'backend/index.ts',
    })
    expect(appOfPath(`${BUNDLED_APPS_PREFIX}demo-app/`)).toEqual({ app: 'demo-app', rest: '' })
    expect(appOfPath(`${BUNDLED_APPS_PREFIX}README.md`)).toBeNull()
    expect(appOfPath(BUNDLED_APPS_DIR)).toBeNull()
    expect(appOfPath('apps/ui/src/main.tsx')).toBeNull()
    expect(appOfPath(`packages/${BUNDLED_APPS_PREFIX}demo-app/x.ts`)).toBeNull()
  })

  test('a path inside an app plugins folder names its contained plugin', () => {
    expect(
      pluginOfPath(`${BUNDLED_APPS_PREFIX}demo-app/plugins/demo-app/skills/play/SKILL.md`),
    ).toEqual({
      app: 'demo-app',
      plugin: 'demo-app',
      rest: 'skills/play/SKILL.md',
    })
    expect(pluginOfPath(`${BUNDLED_APPS_PREFIX}demo-app/skills/play/SKILL.md`)).toBeNull()
    expect(pluginOfPath(`${BUNDLED_APPS_PREFIX}demo-app/plugins/demo-app`)).toBeNull()
  })

  test('the bundled root of a checkout is its bundled folder', () => {
    expect(bundledAppsRoot('/repo')).toBe(join('/repo', BUNDLED_APPS_DIR))
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

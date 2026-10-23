import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import path from 'node:path'

import { assertPositiveControl, exemptionKey, scanSources } from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * THE PLUGIN → HOST BOUNDARY.
 *
 * A bundled plugin is supposed to compile against `@localixai/mini-app-sdk` and nothing else of
 * ours — the SDK is the seam, and the host implements it. But because the plugins live in this
 * repo and are bundled by the host's own bundler, a plugin CAN reach straight into
 * `apps/api/src` by relative path (`../../../apps/api/src/...`), bypassing the SDK entirely.
 * That is the boundary violation this guard polices.
 *
 * Framework contracts and portable utilities live in the SDK (context fabric,
 * resource refs, search, typed errors, lifecycle helpers, document ports, and
 * registration contracts). Stateful host behavior is exposed through narrow
 * `PluginContext` services instead of relative imports.
 *
 * This is a hard-zero invariant. Host-owned behavior is injected through PluginContext;
 * portable contracts and utilities belong to @localixai/mini-app-sdk.
 *
 * Same source-reading idiom, and same kit, as `ext/safe-file-key-contract.test.ts` and
 * `lib/env-contract.test.ts`: it reads comment-stripped source, proves it is not void, and
 * carries a planted positive control so a green run means "no new violation", never "the
 * detector quietly stopped matching".
 */

/** Plugin source globs — .ts/.tsx/.mjs, the three a bundled plugin ships. */
const PLUGIN_GLOBS = [
  'mini-apps/**/*.ts',
  'mini-apps/**/*.tsx',
  'mini-apps/**/*.mjs',
  'plugins/**/*.ts',
  'plugins/**/*.mjs',
]

/**
 * A deep import (or re-export) of the host tree by relative path: two-or-more `../` segments
 * ending inside `apps/api/src`, `apps/ui/src` or `packages/kit/src`. This is EXACTLY the
 * seam-bypass — an `@localixai/mini-app-sdk` or `@localixai/kit/<id>` import has no `../` and never
 * matches. The kit is listed because its primitives came out of `apps/ui/src`: a relative path
 * into it skips the door the host serves at runtime and bundles a second copy of the primitive
 * into the plugin's artifact, which is the same bypass under a new address.
 */
const DEEP_IMPORT_RE =
  /from\s*['"]((?:\.\.\/)+[^'"]*(?:apps\/(?:api|ui)|packages\/kit)\/src\/[^'"]+)['"]/g

/** `../../../apps/api/src/lib/env` → `apps/api/src/lib/env`. */
const normalizeTarget = (spec: string): string => spec.replace(/^(?:\.\.\/)+/, '')

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..', '..', '..')

const skipTests = (f: string): boolean => f.includes('.test.')

/** Every `<pluginFile>::<host-target>` deep import under `root`. */
async function scanDeepImports(root: string, minFiles: number): Promise<string[]> {
  const files = await scanSources({ root, include: PLUGIN_GLOBS, skip: skipTests, minFiles })
  const hits: string[] = []
  for (const f of files) {
    for (const m of f.code.matchAll(DEEP_IMPORT_RE)) {
      hits.push(exemptionKey(f.file, normalizeTarget(m[1] as string)))
    }
  }
  return hits
}

async function offendersIn(root: string, minFiles = 1): Promise<string[]> {
  return scanDeepImports(root, minFiles)
}

describe('plugin → host boundary contract', () => {
  test('plugins have zero production deep imports of host internals', async () => {
    const offenders = await offendersIn(REPO_ROOT, 200)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'A plugin reaches into host internals. Move portable contracts/utilities to ' +
            '@localixai/mini-app-sdk or inject host-owned behavior through PluginContext:\n  ' +
            offenders.join('\n  '),
    ).toEqual([])
  })

  test('POSITIVE CONTROL — a planted deep import fires, and never when commented out', async () => {
    await assertPositiveControl({
      subject: 'a plugin deep import of apps/api/src',
      file: 'mini-apps/planted/backend/index.ts',
      offender: `import { thing } from '../../../apps/api/src/lib/thing'\nexport const use = () => thing()\n`,
      detect: (root) => offendersIn(root, 1),
    })
    await assertPositiveControl({
      subject: 'a plugin deep import of packages/kit/src',
      file: 'mini-apps/planted/ui/Panel.tsx',
      offender: `import { Button } from '../../../packages/kit/src/controls/button'\nexport const B = Button\n`,
      detect: (root) => offendersIn(root, 1),
    })
  })
})

/**
 * The same boundary on the UI side, through the `@/` alias (`apps/ui/src`).
 *
 * A plugin's UI is built into its own artifact and loaded by URL, so it can only see the host
 * through the shared modules the host hands it — the SDK and the UI kit, `@localixai/kit/*`. An
 * `@/…` import would compile a copy of host internals into the plugin (the artifact build refuses
 * it; this guard says so before anyone builds). Tests included: they have `@localixai/kit/testing`.
 */
const HOST_ALIAS_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bmock\.module\s*\(\s*)['"](@\/[^'"]+)['"]/g

async function hostAliasImportsIn(root: string, minFiles = 1): Promise<string[]> {
  const files = await scanSources({ root, include: PLUGIN_GLOBS, minFiles })
  return files.flatMap((f) =>
    [...f.code.matchAll(HOST_ALIAS_RE)].map((m) => exemptionKey(f.file, m[1] as string)),
  )
}

describe('plugin → host UI boundary contract', () => {
  test('no plugin source or test imports host internals through `@/`', async () => {
    const offenders = await hostAliasImportsIn(REPO_ROOT, 200)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'A plugin imports host internals. Use its @localixai/kit module (or add one explicit ' +
            'export to packages/kit/src/entries/<id>.ts):\n  ' +
            offenders.join('\n  '),
    ).toEqual([])
  })

  test('POSITIVE CONTROL — every import form of `@/` fires, and never when commented out', async () => {
    for (const offender of [
      "import { Button } from '@/shared/ui/button'\nexport const B = Button\n",
      "export const load = () => import('@/shared/ui/button')\n",
      "import '@/app/pluginRuntime'\nexport {}\n",
      "mock.module('@/shared/ui/button', () => ({}))\nexport {}\n",
    ]) {
      await assertPositiveControl({
        subject: 'a plugin import of apps/ui/src through @/',
        file: 'mini-apps/planted/ui/Panel.test.tsx',
        offender,
        detect: (root) => hostAliasImportsIn(root, 1),
      })
    }
  })
})

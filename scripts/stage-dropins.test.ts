import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  assertHostModulesImportedByPluginCode,
  bunBuildFailureReason,
  restagePlugin,
  STAGED_DROPINS_MARKER,
  stageDropins,
} from './stage-dropins.mjs'

// Leaving zod external hands every importer the HOST's copy — a dependency written against another
// major would break at runtime with nothing reporting it at build time.
describe('host-provided modules in a staged backend', () => {
  const metafile = (importer: string, path = 'zod') => ({
    inputs: { [importer]: { imports: [{ path, external: true }] } },
  })

  test('the plugin and the workspace packages may import them', () => {
    expect(() =>
      assertHostModulesImportedByPluginCode('p', metafile('plugins/p/backend/index.ts')),
    ).not.toThrow()
    expect(() =>
      assertHostModulesImportedByPluginCode(
        'p',
        metafile('node_modules/@localixai/plugin-sdk/dist/backend/index.js', 'hono'),
      ),
    ).not.toThrow()
  })

  test('a third-party dependency may not', () => {
    expect(() =>
      assertHostModulesImportedByPluginCode('p', metafile('node_modules/some-lib/dist/index.js')),
    ).toThrow('some-lib/dist/index.js')
  })

  test('an external that is not host-provided is not its business', () => {
    expect(() =>
      assertHostModulesImportedByPluginCode(
        'p',
        metafile('node_modules/ssh2/lib/index.js', 'cpu-features'),
      ),
    ).not.toThrow()
  })
})
import { NO_SOURCE_MAPS_FLAG } from './stage-plugin-ui.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

describe('stageDropins', () => {
  test('every first-party plugin manifest is valid JSON before staging', () => {
    const pluginsDir = join(import.meta.dir, '..', 'plugins')
    const manifests = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginsDir, entry.name, 'plugin.json'))
      .filter(existsSync)

    expect(manifests.length).toBeGreaterThan(0)
    for (const manifest of manifests) {
      expect(() => JSON.parse(readFileSync(manifest, 'utf8')), manifest).not.toThrow()
    }
  })

  test('preserves attribution and notice files in the integrity-covered staged tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    const pluginDir = join(root, 'plugins', 'licensed')
    write(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: 'licensed', version: '1.0.0', license: 'MIT' }),
    )
    write(join(pluginDir, 'ATTRIBUTION.md'), 'upstream attribution one\n')
    write(join(pluginDir, 'THIRD_PARTY_NOTICES.md'), 'third-party notice\n')
    write(join(pluginDir, 'ui', 'marks', 'LICENSES', 'Upstream-MIT.txt'), 'license text\n')

    const marker = () =>
      JSON.parse(readFileSync(join(outPlugins, STAGED_DROPINS_MARKER), 'utf8')) as {
        pluginHashes: Record<string, string>
      }

    stageDropins({ repoRoot: root, outPlugins })
    expect(readFileSync(join(outPlugins, 'licensed', 'ATTRIBUTION.md'), 'utf8')).toBe(
      'upstream attribution one\n',
    )
    expect(readFileSync(join(outPlugins, 'licensed', 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(
      'third-party notice\n',
    )
    expect(
      readFileSync(
        join(outPlugins, 'licensed', 'ui', 'marks', 'LICENSES', 'Upstream-MIT.txt'),
        'utf8',
      ),
    ).toBe('license text\n')
    const before = marker().pluginHashes.licensed

    write(join(pluginDir, 'ATTRIBUTION.md'), 'upstream attribution two\n')
    stageDropins({ repoRoot: root, outPlugins })
    expect(marker().pluginHashes.licensed).not.toBe(before)
  })

  test('one plugin that cannot bundle does not take the others down in development', () => {
    // The failure this guards: a single plugin mid-edit aborted staging, which killed the dev API,
    // which killed `bun run dev` — the whole workspace held hostage by one unresolved import.
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')

    write(
      join(root, 'plugins', 'healthy', 'plugin.json'),
      JSON.stringify({ name: 'healthy', version: '1.0.0', tools: './backend/index.ts' }),
    )
    write(join(root, 'plugins', 'healthy', 'backend', 'index.ts'), 'export const tools = []\n')
    write(
      join(root, 'plugins', 'broken', 'plugin.json'),
      JSON.stringify({ name: 'broken', version: '1.0.0', tools: './backend/index.ts' }),
    )
    write(
      join(root, 'plugins', 'broken', 'backend', 'index.ts'),
      "import { doesNotExist } from './missing-module'\nexport const tools = [doesNotExist]\n",
    )

    const { skipped } = stageDropins({ repoRoot: root, outPlugins, onPluginError: 'skip' })

    expect(skipped.map((entry) => entry.name)).toEqual(['broken'])
    // The healthy plugin is fully staged and its manifest repointed at the bundle…
    expect(existsSync(join(outPlugins, 'healthy', 'backend', 'index.bundle.mjs'))).toBe(true)
    // …and the broken one is GONE rather than left half-staged, so the runtime cannot load a
    // plugin whose backend does not exist.
    expect(existsSync(join(outPlugins, 'broken'))).toBe(false)
    // The marker still describes exactly what was staged, and NAMES what was not — with the
    // diagnostic a person acts on, not "Command failed: bun build …".
    const marker = JSON.parse(readFileSync(join(outPlugins, STAGED_DROPINS_MARKER), 'utf8')) as {
      pluginHashes: Record<string, string>
      unavailable: Record<string, string>
    }
    expect(Object.keys(marker.pluginHashes)).toEqual(['healthy'])
    expect(Object.keys(marker.unavailable)).toEqual(['broken'])
    expect(marker.unavailable.broken).toContain('Could not resolve')
    expect(marker.unavailable.broken).toContain('missing-module')
    expect(marker.unavailable.broken).not.toContain('Command failed')
  })

  test('a re-stage that builds again clears the recorded failure; one that breaks records it', () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    const entry = join(root, 'plugins', 'flaky', 'backend', 'index.ts')
    write(
      join(root, 'plugins', 'flaky', 'plugin.json'),
      JSON.stringify({ name: 'flaky', version: '1.0.0', tools: './backend/index.ts' }),
    )
    write(entry, "import { gone } from './missing-module'\nexport const tools = [gone]\n")
    const unavailable = () =>
      (
        JSON.parse(readFileSync(join(outPlugins, STAGED_DROPINS_MARKER), 'utf8')) as {
          unavailable: Record<string, string>
        }
      ).unavailable

    stageDropins({ repoRoot: root, outPlugins, onPluginError: 'skip' })
    expect(Object.keys(unavailable())).toEqual(['flaky'])

    write(entry, 'export const tools = []\n')
    restagePlugin({ repoRoot: root, outPlugins, name: 'flaky' })
    expect(unavailable()).toEqual({})
    expect(existsSync(join(outPlugins, 'flaky', 'backend', 'index.bundle.mjs'))).toBe(true)

    write(entry, "import { gone } from './missing-module'\nexport const tools = [gone]\n")
    restagePlugin({ repoRoot: root, outPlugins, name: 'flaky' })
    expect(Object.keys(unavailable())).toEqual(['flaky'])
  })

  test('a bun build failure reason keeps the error lines and their repository-relative place', () => {
    const stderr = [
      "1 | import { generateKeyBetween } from 'fractional-indexing'",
      '                                      ^',
      'error: Could not resolve: "fractional-indexing". Maybe you need to "bun install"?',
      '    at /repo/plugins/project-space/shared/format/order.ts:1:36',
      '',
      'error: Could not resolve: "left-pad"',
    ].join('\n')
    expect(bunBuildFailureReason(stderr, '/repo')).toBe(
      [
        'error: Could not resolve: "fractional-indexing". Maybe you need to "bun install"? (plugins/project-space/shared/format/order.ts:1:36)',
        'error: Could not resolve: "left-pad"',
      ].join('\n'),
    )
  })

  test('a release build refuses to ship when a plugin cannot bundle', () => {
    // The other half of the contract: silently shipping an app with a missing capability is worse
    // than not shipping, so the DEFAULT stays fatal and only development opts out.
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    write(
      join(root, 'plugins', 'broken', 'plugin.json'),
      JSON.stringify({ name: 'broken', version: '1.0.0', tools: './backend/index.ts' }),
    )
    write(
      join(root, 'plugins', 'broken', 'backend', 'index.ts'),
      "import { doesNotExist } from './missing-module'\nexport const tools = [doesNotExist]\n",
    )

    expect(() =>
      stageDropins({ repoRoot: root, outPlugins: join(root, 'staged', 'plugins') }),
    ).toThrow()
  })

  // Unminified backends were ~40% of the shipped plugins. Minified, a stack trace must still name
  // the plugin's own functions, or a user's crash report says nothing.
  test('a staged backend is minified and keeps its function names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    write(
      join(root, 'plugins', 'small', 'plugin.json'),
      JSON.stringify({ name: 'small', version: '1.0.0', tools: './backend/index.ts' }),
    )
    write(
      join(root, 'plugins', 'small', 'backend', 'index.ts'),
      [
        'export function describeTheFailure(reason: string) {',
        '  const message = `failed: ${reason}`',
        '  return new Error(message).stack ?? message',
        '}',
      ].join('\n'),
    )

    stageDropins({ repoRoot: root, outPlugins })

    const bundle = readFileSync(join(outPlugins, 'small', 'backend', 'index.bundle.mjs'), 'utf8')
    // Whitespace: no indented line survives. Syntax: `new Error(…)` is shortened to `Error(…)`.
    expect(bundle).not.toMatch(/\n[ \t]+\S/u)
    expect(bundle).not.toContain('new Error')
    // Identifiers are kept: the name a stack trace prints is the one in the source.
    expect(bundle).toContain('function describeTheFailure(reason)')
    const loaded = (await import(
      `${pathToFileURL(join(outPlugins, 'small', 'backend', 'index.bundle.mjs')).href}?minified`
    )) as { describeTheFailure: (reason: string) => string }
    expect(loaded.describeTheFailure('x')).toContain('describeTheFailure')
  })

  // A gitignored `dist/` rode into a release built on a laptop and not into one built by CI: the
  // shipped tree depended on the build machine. Build output ships only when the manifest names it.
  test('a plugin dist ships only when its manifest declares a runtime file there', () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    write(
      join(root, 'plugins', 'built-locally', 'plugin.json'),
      JSON.stringify({ name: 'built-locally', version: '1.0.0' }),
    )
    write(join(root, 'plugins', 'built-locally', 'dist', 'preview', 'index.html'), '<p>local</p>')
    write(join(root, 'plugins', 'built-locally', 'docs', 'dist', 'kept.md'), 'nested\n')
    write(join(root, 'plugins', 'built-locally', 'ui', 'register.tsx'), 'export {}\n')
    write(
      join(root, 'plugins', 'prebuilt', 'plugin.json'),
      JSON.stringify({ name: 'prebuilt', version: '1.0.0', skills: './dist/skills' }),
    )
    write(join(root, 'plugins', 'prebuilt', 'dist', 'skills', 'SKILL.md'), 'declared\n')

    const uiBuilds: string[][] = []
    stageDropins({
      repoRoot: root,
      outPlugins,
      uiSourceMaps: false,
      runUiBuild: ((_command: string, args: string[]) => uiBuilds.push(args)) as never,
    })

    expect(existsSync(join(outPlugins, 'built-locally', 'dist'))).toBe(false)
    expect(existsSync(join(outPlugins, 'built-locally', 'docs', 'dist', 'kept.md'))).toBe(true)
    expect(readFileSync(join(outPlugins, 'prebuilt', 'dist', 'skills', 'SKILL.md'), 'utf8')).toBe(
      'declared\n',
    )
    // Release staging's `uiSourceMaps: false` reaches the builder (whose own tests prove the flag
    // leaves the maps out); the default call, in the test below, carries no flag.
    expect(uiBuilds).toEqual([
      [
        join(import.meta.dir, 'build-plugin-ui.mjs'),
        join(root, 'plugins', 'built-locally'),
        join(outPlugins, 'built-locally', 'dist', 'ui'),
        join(root, 'staged', 'plugin-kit'),
        NO_SOURCE_MAPS_FLAG,
      ],
    ])
  })

  test('omits compiled plugin UI source while preserving runtime files and bundled imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    const pluginDir = join(root, 'plugins', 'compiled-ui')
    write(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'compiled-ui',
        version: '1.0.0',
        tools: './backend/index.ts',
        commands: [
          {
            name: 'fixture',
            args: [
              {
                name: 'option',
                type: 'choice',
                optionsScript: './arg-sources/options.ts',
              },
            ],
          },
        ],
      }),
    )
    write(
      join(pluginDir, 'backend', 'index.ts'),
      "export { implementation } from './implementation'\nexport { options } from '../arg-sources/options'\nexport { sharedValue } from '../ui/model/shared'\nconst runtimePath = './runtime.ts'\nexport async function loadRuntime() { return (await import(runtimePath)).default }\n",
    )
    write(
      join(pluginDir, 'backend', 'implementation.ts'),
      "export { implementation } from '../shared/implementation'\n",
    )
    write(
      join(pluginDir, 'shared', 'implementation.ts'),
      "export const implementation = 'bundled'\n",
    )
    write(join(pluginDir, 'backend', 'runtime.ts'), "export default 'dynamic'\n")
    write(join(pluginDir, 'ui', 'register.tsx'), 'export const register = true\n')
    write(join(pluginDir, 'ui', 'model', 'shared.ts'), "export const sharedValue = 'bundled'\n")
    write(join(pluginDir, 'docker', 'ui', 'register.tsx'), 'export const nested = true\n')
    write(join(pluginDir, 'ui', 'activity', 'runtime.css'), '.runtime { display: block }\n')
    write(join(pluginDir, 'ui', 'marks', 'ATTRIBUTION.md'), 'upstream attribution\n')
    write(join(pluginDir, 'ui', 'marks', 'LICENSES', 'Upstream-MIT.txt'), 'license text\n')
    write(
      join(pluginDir, 'arg-sources', 'options.ts'),
      "export { options } from './options-helper'\n",
    )
    write(join(pluginDir, 'arg-sources', 'options-helper.ts'), "export const options = ['kept']\n")

    // The UI artifact builder is a child `bun`; record its invocation instead of building a
    // fixture that has no host to build against (the builder has tests of its own).
    const uiBuilds: string[][] = []
    stageDropins({
      repoRoot: root,
      outPlugins,
      runUiBuild: ((_command: string, args: string[]) => {
        uiBuilds.push(args.slice(1))
        return ''
      }) as never,
    })

    const stagedPlugin = join(outPlugins, 'compiled-ui')
    // The UI is built FROM the repo sources INTO the staged copy, against the plugin kit staged
    // beside the plugins — the same inputs the installed app builds a user plugin with.
    expect(uiBuilds).toEqual([
      [pluginDir, join(stagedPlugin, 'dist', 'ui'), join(root, 'staged', 'plugin-kit')],
    ])
    expect(existsSync(join(stagedPlugin, 'ui', 'register.tsx'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'ui', 'model', 'shared.ts'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'docker', 'ui', 'register.tsx'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'backend', 'index.ts'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'backend', 'implementation.ts'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'shared', 'implementation.ts'))).toBe(false)
    expect(existsSync(join(stagedPlugin, 'backend', 'runtime.ts'))).toBe(true)
    expect(readFileSync(join(stagedPlugin, 'ui', 'activity', 'runtime.css'), 'utf8')).toBe(
      '.runtime { display: block }\n',
    )
    expect(readFileSync(join(stagedPlugin, 'ui', 'marks', 'ATTRIBUTION.md'), 'utf8')).toBe(
      'upstream attribution\n',
    )
    expect(
      readFileSync(join(stagedPlugin, 'ui', 'marks', 'LICENSES', 'Upstream-MIT.txt'), 'utf8'),
    ).toBe('license text\n')
    expect(existsSync(join(stagedPlugin, 'arg-sources', 'options.ts'))).toBe(true)
    expect(existsSync(join(stagedPlugin, 'arg-sources', 'options-helper.ts'))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(stagedPlugin, 'plugin.json'), 'utf8')) as {
      tools: string
    }
    expect(manifest.tools).toBe('./backend/index.bundle.mjs')
    const bundled = (await import(
      `${pathToFileURL(join(stagedPlugin, manifest.tools)).href}?compiled-ui`
    )) as {
      implementation: string
      loadRuntime: () => Promise<string>
      options: string[]
      sharedValue: string
    }
    expect(bundled.sharedValue).toBe('bundled')
    expect(bundled.implementation).toBe('bundled')
    expect(bundled.options).toEqual(['kept'])
    expect(await bundled.loadRuntime()).toBe('dynamic')
    const options = (await import(
      `${pathToFileURL(join(stagedPlugin, 'arg-sources', 'options.ts')).href}?compiled-ui-options`
    )) as { options: string[] }
    expect(options.options).toEqual(['kept'])
    expect(existsSync(join(outPlugins, STAGED_DROPINS_MARKER))).toBe(true)
  })

  test('strips repository-only cache and compatibility catalog directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')
    const pluginDir = join(root, 'plugins', 'clean')
    write(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: 'clean', version: '1.0.0', license: 'MIT' }),
    )
    write(join(pluginDir, '.turbo', 'cache.json'), '{}')
    write(join(root, 'plugins', '.localix-plugin', 'marketplace.json'), '{}')

    stageDropins({ repoRoot: root, outPlugins })

    expect(existsSync(join(outPlugins, 'clean', '.turbo'))).toBe(false)
    expect(existsSync(join(outPlugins, '.localix-plugin'))).toBe(false)
  })

  test('bundles JS/MJS/TS tools so staged plugins do not need the repo node_modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'localix-stage-dropins-'))
    roots.push(root)
    const outPlugins = join(root, 'staged', 'plugins')

    write(
      join(root, 'node_modules', 'fixture-dependency', 'package.json'),
      JSON.stringify({ name: 'fixture-dependency', type: 'module', exports: './index.js' }),
    )
    write(
      join(root, 'node_modules', 'fixture-dependency', 'index.js'),
      "export const dependencyValue = 'bundled-dependency'\n",
    )
    write(
      join(root, 'node_modules', 'lazy-dependency', 'package.json'),
      JSON.stringify({ name: 'lazy-dependency', type: 'module', exports: './index.js' }),
    )
    write(
      join(root, 'node_modules', 'lazy-dependency', 'index.js'),
      "export const lazyValue = 'lazy-value-one'\n",
    )

    const entries = [
      ['javascript', './tools/index.js', "export const language = 'js'"],
      ['module-js', './tools/index.mjs', "export const language = 'mjs'"],
      ['typescript', './tools/index.ts', "export const language: string = 'ts'"],
    ] as const

    for (const [name, tools, source] of entries) {
      write(
        join(root, 'plugins', name, 'plugin.json'),
        JSON.stringify({ name, version: '1.0.0', tools }),
      )
      write(
        join(root, 'plugins', name, tools),
        `import { dependencyValue } from 'fixture-dependency'\n${source}\nexport const value = dependencyValue\nexport async function loadLazyValue() {\n  return (await import('lazy-dependency')).lazyValue\n}\n`,
      )
    }

    stageDropins({ repoRoot: root, outPlugins })
    /**
     * Schema 2 added `pluginHashes`, and they are LOAD-BEARING, not metadata: a cold
     * capability read validates the staged tree against them instead of re-hashing the
     * whole packaged payload (156MB / 1006 files, ~110ms a read). So this asserts the
     * contract a consumer relies on — one hash per staged plugin, named algorithm — and
     * then that a same-LENGTH content change moves the hash, because a length- or
     * mtime-only fingerprint would silently accept an edited plugin as unchanged.
     */
    const marker = () =>
      JSON.parse(readFileSync(join(outPlugins, STAGED_DROPINS_MARKER), 'utf8')) as {
        kind: string
        schemaVersion: number
        hashAlgorithm: string
        pluginHashes: Record<string, string>
      }
    const staged = marker()
    expect(staged.kind).toBe('localix-staged-plugins')
    expect(staged.schemaVersion).toBe(3)
    expect(staged.hashAlgorithm).toBe('sha256')
    expect(Object.keys(staged.pluginHashes).sort()).toEqual([
      'javascript',
      'module-js',
      'typescript',
    ])
    for (const hash of Object.values(staged.pluginHashes)) expect(hash).toMatch(/^[0-9a-f]{64}$/u)

    const before = staged.pluginHashes.javascript
    write(
      join(root, 'node_modules', 'lazy-dependency', 'index.js'),
      "export const lazyValue = 'lazy-value-two'\n",
    )
    stageDropins({ repoRoot: root, outPlugins })
    expect(marker().pluginHashes.javascript).not.toBe(before)
    rmSync(join(root, 'node_modules'), { recursive: true, force: true })

    for (const [name] of entries) {
      const stagedPlugin = join(outPlugins, name)
      const manifest = JSON.parse(readFileSync(join(stagedPlugin, 'plugin.json'), 'utf8')) as {
        tools: string
      }
      expect(manifest.tools).toBe('./backend/index.bundle.mjs')
      const bundledEntry = join(stagedPlugin, manifest.tools)
      expect(existsSync(bundledEntry)).toBe(true)
      const chunksDir = join(stagedPlugin, 'backend', 'chunks')
      const chunks = readdirSync(chunksDir)
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) expect(chunk).toMatch(/^index-[a-z0-9]+\.js$/u)
      expect(readFileSync(bundledEntry, 'utf8')).not.toContain('lazy-value-two')
      expect(
        chunks.filter((chunk) =>
          readFileSync(join(chunksDir, chunk), 'utf8').includes('lazy-value-two'),
        ),
      ).toHaveLength(1)

      const loaded = (await import(`${pathToFileURL(bundledEntry).href}?plugin=${name}`)) as {
        language: string
        loadLazyValue: () => Promise<string>
        value: string
      }
      expect(loaded.language).toBe(
        name === 'javascript' ? 'js' : name === 'module-js' ? 'mjs' : 'ts',
      )
      expect(loaded.value).toBe('bundled-dependency')
      expect(await loaded.loadLazyValue()).toBe('lazy-value-two')
    }
  })
})

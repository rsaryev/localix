import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildRuntimeNotices,
  collectRuntimeNoticePackages,
  stageThirdPartyNotices,
} from './stage-third-party-notices.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function manifest(root: string, path: string, value: object): void {
  write(join(root, path, 'package.json'), JSON.stringify(value))
}

function externalPackage(
  root: string,
  name: string,
  value: Record<string, unknown>,
  licenseText?: string,
): void {
  const path = join('node_modules', ...name.split('/'))
  manifest(root, path, { name, version: '1.0.0', main: './index.js', ...value })
  write(join(root, path, 'index.js'), 'export default true\n')
  if (licenseText) write(join(root, path, 'LICENSE'), licenseText)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'localix-third-party-notices-'))
  roots.push(root)
  manifest(root, '', { private: true, workspaces: ['apps/*', 'packages/*', 'plugins/*'] })
  manifest(root, 'apps/api', { name: '@fixture/api', devDependencies: { 'dev-only': '1.0.0' } })
  manifest(root, 'apps/ui', {
    name: '@fixture/ui',
    dependencies: { '@fixture/local': 'workspace:*' },
  })
  manifest(root, 'apps/landing', {
    name: '@fixture/landing',
    dependencies: { 'landing-only': '1.0.0' },
  })
  manifest(root, 'packages/local', {
    name: '@fixture/local',
    dependencies: { 'external-a': '1.0.0' },
  })
  manifest(root, 'plugins/runtime', {
    name: '@fixture/plugin-runtime',
    dependencies: { 'plugin-only': '1.0.0' },
  })
  manifest(root, 'plugins/scaffold', {
    name: '@fixture/plugin-scaffold',
    dependencies: { 'private-only': '1.0.0' },
  })
  write(join(root, 'plugins/scaffold/plugin.json'), JSON.stringify({ private: true }))

  externalPackage(
    root,
    'external-a',
    {
      license: 'MIT',
      dependencies: { 'external-b': '2.0.0' },
      optionalDependencies: { 'missing-platform-package': '1.0.0' },
    },
    'external-a license\r\n',
  )
  manifest(root, 'node_modules/external-a/node_modules/external-b', {
    name: 'external-b',
    version: '2.0.0',
    license: 'ISC',
  })
  externalPackage(root, 'plugin-only', { license: 'Apache-2.0' }, 'plugin license\n')
  externalPackage(root, 'landing-only', { license: 'MIT' }, 'landing license\n')
  externalPackage(root, 'private-only', { license: 'MIT' }, 'private license\n')
  externalPackage(root, 'dev-only', { license: 'MIT' }, 'dev license\n')

  write(join(root, 'vendor/monaco-editor-runtime/LICENSE'), 'monaco license\n')
  write(join(root, 'vendor/monaco-editor-runtime/ThirdPartyNotices.txt'), 'monaco notices\n')
  write(
    join(root, 'vendor/monaco-editor-runtime/THIRD_PARTY_NOTICES.localix.txt'),
    'monaco bundled-dependency notices\n',
  )
  write(join(root, 'packages/engine/licenses/pi-LICENSE.txt'), 'pi license\n')
  write(join(root, 'packages/engine-scripts/licenses/quickjs-ng-LICENSE.txt'), 'quickjs license\n')
  return root
}

describe('third-party runtime notices', () => {
  test('collects only the transitive runtime closure for each distributable target', () => {
    const root = fixture()

    expect(collectRuntimeNoticePackages({ repoRoot: root }).map(({ name }) => name)).toEqual([
      'external-a',
      'external-b',
      'plugin-only',
    ])
    expect(
      collectRuntimeNoticePackages({ repoRoot: root, target: 'landing' }).map(({ name }) => name),
    ).toEqual(['landing-only'])
  })

  test('normalizes license text deterministically and records metadata-only licenses', () => {
    const root = fixture()
    const first = buildRuntimeNotices({ repoRoot: root })
    const second = buildRuntimeNotices({ repoRoot: root })

    expect(second).toBe(first)
    expect(first).toContain('external-a license\n')
    expect(first).not.toContain('\r')
    expect(first).toContain('external-b@2.0.0\nDeclared license: ISC')
    expect(first).toContain('No license or notice text was included in the installed package.')
    expect(first).not.toContain('private-only')
    expect(first).not.toContain('dev-only')
  })

  test('stages vendored notices only for the product target', () => {
    const root = fixture()
    const product = join(root, 'out-product')
    const landing = join(root, 'out-landing')

    stageThirdPartyNotices({ repoRoot: root, destination: product })
    stageThirdPartyNotices({ repoRoot: root, destination: landing, target: 'landing' })

    expect(readdirSync(product).sort()).toEqual([
      'monaco-editor-LICENSE.txt',
      'monaco-editor-ThirdPartyNotices.txt',
      'monaco-editor-bundled-dependencies-NOTICES.txt',
      'npm-runtime-THIRD_PARTY_NOTICES.txt',
      'pi-LICENSE.txt',
      'quickjs-ng-LICENSE.txt',
    ])
    expect(readdirSync(landing)).toEqual(['npm-runtime-THIRD_PARTY_NOTICES.txt'])
    expect(readFileSync(join(landing, 'npm-runtime-THIRD_PARTY_NOTICES.txt'), 'utf8')).toContain(
      'landing-only@1.0.0',
    )
  })

  test('a desktop build adds the Bun runtime and only the crates linked into the shell', () => {
    const root = fixture()
    write(
      join(root, 'apps/desktop-tauri/licenses/bun-LICENSE.txt'),
      'Bun itself is MIT-licensed.\n',
    )
    const crate = (name: string, license: string | null, text?: string) => {
      const manifestPath = join(root, 'registry', name, 'Cargo.toml')
      write(manifestPath, `[package]\nname = "${name}"\n`)
      if (text) write(join(root, 'registry', name, 'LICENSE-MIT'), text)
      return { id: name, name, version: '1.0.0', license, manifest_path: manifestPath }
    }
    const normal = [{ kind: null, target: null }]
    const metadata = {
      workspace_members: ['shell'],
      packages: [
        crate('shell', 'MIT'),
        crate('linked', 'MIT OR Apache-2.0', 'linked license\r\n'),
        crate('transitive', 'Zlib'),
        crate('build-only', 'MIT'),
        crate('test-only', 'MIT'),
      ],
      resolve: {
        root: 'shell',
        nodes: [
          {
            id: 'shell',
            deps: [
              { pkg: 'linked', dep_kinds: normal },
              { pkg: 'build-only', dep_kinds: [{ kind: 'build', target: null }] },
              { pkg: 'test-only', dep_kinds: [{ kind: 'dev', target: null }] },
            ],
          },
          { id: 'linked', deps: [{ pkg: 'transitive', dep_kinds: normal }] },
          { id: 'transitive', deps: [] },
        ],
      },
    }
    const destination = join(root, 'out-desktop')

    stageThirdPartyNotices({ repoRoot: root, destination, desktop: { metadata } })

    expect(readdirSync(destination)).toContain('bun-runtime-LICENSE.txt')
    const rust = readFileSync(join(destination, 'rust-crates-THIRD_PARTY_NOTICES.txt'), 'utf8')
    expect(rust).toContain('Crates: 2')
    expect(rust).toContain('linked@1.0.0\nDeclared license: MIT OR Apache-2.0\n--- LICENSE-MIT ---')
    expect(rust).toContain('linked license\n')
    expect(rust).not.toContain('\r')
    expect(rust).toContain('transitive@1.0.0\nDeclared license: Zlib')
    for (const absent of ['shell@', 'build-only', 'test-only']) expect(rust).not.toContain(absent)
  })
})

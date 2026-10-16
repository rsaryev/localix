import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyManifestPolicy, ownedScriptDrift, ownedScripts, ownership } from './manifest-policy'

const manifest = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name: '@earendil-works/chord', version: '0.87.1', ...extra, scripts }, null, '\t')}\n`

// The chord manifest exactly as the 0.87 sync met it.
const base = manifest({
  clean: 'shx rm -rf dist',
  build: 'tsgo -p tsconfig.build.json',
  test: 'vitest --run',
  prepublishOnly: 'npm run clean && npm run build',
})
const head = manifest({
  clean: 'shx rm -rf dist',
  build: 'tsc -p tsconfig.build.json',
  test: 'vitest --run',
  prepublishOnly: 'npm run clean && npm run build',
})
const ours = manifest(
  {
    clean: 'shx rm -rf dist',
    build: 'tsc -p tsconfig.build.json',
    'type-check': 'tsc --noEmit -p tsconfig.build.json',
    'test:upstream': 'vitest --run',
    prepublishOnly: 'npm run clean && npm run build',
  },
  { private: true },
)

/** The three-way merge git itself would run over these inputs. */
async function mergeFile(current: string, ancestor: string, other: string) {
  const dir = await mkdtemp(join(tmpdir(), 'manifest-policy-'))
  try {
    const [a, b, c] = ['current', 'base', 'other'].map((name) => join(dir, name))
    await Promise.all([Bun.write(a!, current), Bun.write(b!, ancestor), Bun.write(c!, other)])
    const proc = Bun.spawn(['git', 'merge-file', '-p', a!, b!, c!], { stdout: 'pipe' })
    const merged = await new Response(proc.stdout).text()
    return { clean: (await proc.exited) === 0, merged }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('owned scripts', () => {
  test('are the keys our copy set differently from upstream base — added, changed or removed', () => {
    expect(ownedScripts(ours, base)).toEqual(['build', 'test', 'test:upstream', 'type-check'])
  })

  test('drift names only an owned key upstream moved to something other than ours', () => {
    // `build` moved tsgo → tsc upstream, which IS ours: adopted, nothing to decide.
    expect(ownedScriptDrift(ours, base, head)).toEqual([])
    const moved = head.replace('"test": "vitest --run"', '"test": "vitest --run --bail"')
    expect(ownedScriptDrift(ours, base, moved)).toEqual([
      { key: 'test', base: 'vitest --run', head: 'vitest --run --bail', ours: undefined },
    ])
  })
})

describe('applyManifestPolicy', () => {
  // The 0.87 failure: without the policy these three inputs conflict, because our `type-check`
  // line sits beside the `build` line upstream edited.
  test('the raw manifests conflict — the case the policy exists for', async () => {
    expect((await mergeFile(ours, base, head)).clean).toBe(false)
  })

  test('with the policy on both upstream sides, the merge is clean and keeps every decision', async () => {
    const owned = ownership(ours, base)
    const merged = await mergeFile(
      ours,
      applyManifestPolicy(base, ours, { ownership: owned }),
      applyManifestPolicy(head, ours, { ownership: owned }),
    )
    expect(merged.clean).toBe(true)
    expect(merged.merged).toBe(ours)
  })

  test('an upstream edit to a script we do not own still flows in', async () => {
    const edited = head.replace(
      'npm run clean && npm run build',
      'npm run clean && npm run build:all',
    )
    const owned = ownership(ours, base)
    const merged = await mergeFile(
      ours,
      applyManifestPolicy(base, ours, { ownership: owned }),
      applyManifestPolicy(edited, ours, { ownership: owned }),
    )
    expect(merged.clean).toBe(true)
    expect(JSON.parse(merged.merged).scripts.prepublishOnly).toBe(
      'npm run clean && npm run build:all',
    )
    expect(JSON.parse(merged.merged).scripts['type-check']).toBe(
      'tsc --noEmit -p tsconfig.build.json',
    )
  })

  test('workspace ranges and the private guard are ours on both sides', () => {
    const withDeps = (range: string) =>
      manifest({ build: 'tsc' }).replace(
        '\t"scripts"',
        `\t"dependencies": {\n\t\t"@earendil-works/pi-ai": "${range}"\n\t},\n\t"scripts"`,
      )
    const patched = applyManifestPolicy(
      withDeps('^0.87.1'),
      withDeps('workspace:*').replace(
        '"version": "0.87.1",',
        '"version": "0.87.1",\n\t"private": true,',
      ),
    )
    expect(JSON.parse(patched).dependencies['@earendil-works/pi-ai']).toBe('workspace:*')
    expect(JSON.parse(patched).private).toBe(true)
  })

  // The ai manifest's other delta: upstream's `canvas` devDependency is omitted (it breaks the
  // desktop sidecar bundle). Upstream bumps the neighbouring `vitest` line every few releases.
  test('a dependency Localix removed stays removed while upstream bumps its neighbours', async () => {
    const devDeps = (entries: string) =>
      manifest({ build: 'tsc' }).replace(
        '\t"scripts"',
        `\t"devDependencies": {\n${entries}\n\t},\n\t"scripts"`,
      )
    const upstreamBase = devDeps(
      '\t\t"@types/node": "22.19.19",\n\t\t"canvas": "3.2.3",\n\t\t"vitest": "4.1.9"',
    )
    const upstreamHead = devDeps(
      '\t\t"@types/node": "22.19.20",\n\t\t"canvas": "3.2.3",\n\t\t"vitest": "4.2.0"',
    )
    const fork = devDeps('\t\t"@types/node": "22.19.19",\n\t\t"vitest": "4.1.9"')

    expect((await mergeFile(fork, upstreamBase, upstreamHead)).clean).toBe(false)
    const owned = ownership(fork, upstreamBase)
    expect(owned.removedDependencies).toEqual({ devDependencies: ['canvas'] })
    const merged = await mergeFile(
      fork,
      applyManifestPolicy(upstreamBase, fork, { ownership: owned }),
      applyManifestPolicy(upstreamHead, fork, { ownership: owned }),
    )
    expect(merged.clean).toBe(true)
    expect(JSON.parse(merged.merged).devDependencies).toEqual({
      '@types/node': '22.19.20',
      vitest: '4.2.0',
    })
  })

  test('a manifest the scripts parser cannot read is left for the merge, never corrupted', () => {
    const odd = base.replace('"scripts": {', '"scripts": { "inline": "x",')
    const patched = applyManifestPolicy(odd, ours, {
      ownership: { scripts: ['type-check'], removedDependencies: {} },
    })
    // The scripts block stays upstream's bytes; only the independent `private` guard is applied.
    expect(patched.slice(patched.indexOf('"scripts"'))).toBe(odd.slice(odd.indexOf('"scripts"')))
    expect(JSON.parse(patched).scripts['type-check']).toBeUndefined()
  })
})

import { describe, expect, test } from 'bun:test'

/**
 * ONE board library, and one copy of it.
 *
 * Every board in the app — the code map, its call lens, the database diagram, and whatever board
 * a mini app draws next — runs on `@localixai/kit/canvas`, which the host serves from its single
 * copy of `@xyflow/react`. Two ways to get a board that is *almost* the app's, both of which
 * happened before this file existed:
 *
 *  1. Import the flow library directly. The board then carries its own camera (the database
 *     diagram zoomed on scroll while the code map panned; only the code map answered a pinch in
 *     the desktop app) and its own theme (black arrowheads on a dark ground).
 *  2. Declare the library as a mini app dependency. The mini app's artifact then bundles a SECOND
 *     copy, whose `Handle` looks for a store context the host's `Canvas` never provided — and
 *     throws at render.
 *
 * So only the kit's canvas primitive imports the library, and no other package declares
 * it. The host bundles the kit from source, so its own declaration may only repeat the kit's range
 * — two ranges are how a workspace ends up resolving two copies. The positive control at the
 * bottom plants each defect, because a scanner that reads nothing satisfies both rules too.
 */

const REPO_ROOT = new URL('../', import.meta.url).pathname
const SOURCE_ROOTS = ['apps/ui/src', 'packages'] as const
/** The primitive that IS the app's board, and so the only place allowed to name the library. */
const PRIMITIVE_OWNER = 'packages/kit/src/canvas/'
/** The one package allowed to depend on it: the kit that owns the canvas primitive. */
const KIT_MANIFEST = 'packages/kit/package.json'
/** The host that bundles the kit from source; a declaration here must match the kit's range. */
const HOST_MANIFEST = 'apps/ui/package.json'

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const FLOW_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"]@xyflow\//u

function scan(source: string): number[] {
  return source
    .split('\n')
    .map((line, index) => (FLOW_IMPORT.test(line) ? index + 1 : 0))
    .filter((lineNumber) => lineNumber > 0)
}

function declaredFlowRanges(manifest: string): Record<string, string> {
  const parsed = JSON.parse(manifest) as Record<string, Record<string, string> | undefined>
  const ranges: Record<string, string> = {}
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(parsed[field] ?? {})) {
      if (name.startsWith('@xyflow/')) ranges[name] = range
    }
  }
  return ranges
}

function declaredFlowPackages(manifest: string): string[] {
  return Object.keys(declaredFlowRanges(manifest))
}

function sourceFiles(): string[] {
  const paths: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const path of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: `${REPO_ROOT}/${root}` })) {
      if (path.includes('node_modules') || path.includes('/dist/')) continue
      paths.push(`${root}/${path}`)
    }
  }
  return paths.sort()
}

function manifests(): string[] {
  const paths: string[] = []
  for (const root of ['packages']) {
    for (const path of new Bun.Glob('*/package.json').scanSync({ cwd: `${REPO_ROOT}/${root}` })) {
      paths.push(`${root}/${path}`)
    }
  }
  return paths.sort()
}

describe('canvas surface guard', () => {
  test('only the kit canvas primitive imports the flow library', async () => {
    const offences: string[] = []
    for (const path of sourceFiles()) {
      if (path.startsWith(PRIMITIVE_OWNER)) continue
      const lines = (await Bun.file(`${REPO_ROOT}/${path}`).text()).split('\n')
      for (const line of scan(lines.join('\n'))) {
        offences.push(`${path}:${line} — ${lines[line - 1]?.trim()} (use @localixai/kit/canvas)`)
      }
    }
    expect(offences.join('\n')).toBe('')
  })

  test('only the kit declares the flow library; the host repeats its range or none', async () => {
    const offences: string[] = []
    for (const path of manifests()) {
      if (path === KIT_MANIFEST) continue
      for (const name of declaredFlowPackages(await Bun.file(`${REPO_ROOT}/${path}`).text())) {
        offences.push(`${path} declares ${name}`)
      }
    }
    expect(offences.join('\n')).toBe('')
    const kit = declaredFlowRanges(await Bun.file(`${REPO_ROOT}/${KIT_MANIFEST}`).text())
    expect(Object.keys(kit)).toContain('@xyflow/react')
    const host = declaredFlowRanges(await Bun.file(`${REPO_ROOT}/${HOST_MANIFEST}`).text())
    for (const [name, range] of Object.entries(host)) {
      expect(`${name}@${range}`).toBe(`${name}@${kit[name]}`)
    }
  })

  test('positive control: each detector reports its planted defect', () => {
    expect(scan(`import { Handle } from '@xyflow/react'\n`)).toEqual([1])
    expect(scan(`const x = 1\nimport '@xyflow/react/dist/style.css'\n`)).toEqual([2])
    expect(scan(`const flow = await import('@xyflow/react')\n`)).toEqual([1])
    expect(scan(`import { Canvas } from '@localixai/kit/canvas'\n`)).toEqual([])
    expect(declaredFlowPackages('{"dependencies":{"@xyflow/react":"^12"}}')).toEqual([
      '@xyflow/react',
    ])
    expect(declaredFlowPackages('{"devDependencies":{"dagre":"^0.8"}}')).toEqual([])
    expect(declaredFlowRanges('{"peerDependencies":{"@xyflow/react":"^11"}}')).toEqual({
      '@xyflow/react': '^11',
    })
  })
})

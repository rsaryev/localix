/**
 * How a subpath of `@localixai/mini-app-sdk` is weighed.
 *
 * Not a file size: a probe that IMPORTS the subpath is bundled with `Bun.build` and the output is
 * measured, because the number worth guarding is what a consumer pays — the subpath plus everything
 * it drags in, minus everything a bundler can shake out. `mini-app-sdk-bytes-guard.test.ts` holds the
 * policy; this holds the measurement, so the rules stay readable next to each other.
 *
 * Two decisions are baked in here, and both are the difference between a number and a noise:
 *
 *  - Bare specifiers stay EXTERNAL. This budget is the SDK's own bytes; `zod` getting fatter is a
 *    real cost but not one this guard can act on, and bundling it in would drown the signal. The
 *    filter matches specifiers starting with neither `.` nor `/` — an `onResolve` over everything
 *    swallows the relative graph too, and a measurement that reads near-zero looks like a win.
 *  - The bundle is taken over a COPY of `dist`, the way
 *    `packages/visual-feedback/src/package-contract.test.ts` copies its package. `tsc` emits
 *    extensionless relative specifiers (`from '../resource'`, per `moduleResolution: bundler`), and
 *    under `bun test` those fail to resolve for an entry inside this workspace while resolving fine
 *    from a fixture. The bytes are identical either way — verified against the same measurement run
 *    in place under `bun run` — so the copy costs nothing and makes the harness run everywhere.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDistBuilt, readExportMap, sdkManifestPath, sdkRoot } from './mini-app-sdk-exports'

const externalizeDependencies: Bun.BunPlugin = {
  name: 'externalize-dependencies',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }))
  },
}

/** A throwaway root holding `dist` and the one manifest field that governs tree-shaking. */
export function fixtureDist(): string {
  const manifest = JSON.parse(readFileSync(sdkManifestPath, 'utf8')) as {
    name: string
    sideEffects: boolean
  }
  const fixture = mkdtempSync(join(tmpdir(), 'mini-app-sdk-bytes-'))
  cpSync(join(sdkRoot, 'dist'), join(fixture, 'dist'), { recursive: true })
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({ name: manifest.name, type: 'module', sideEffects: manifest.sideEffects }),
  )
  return fixture
}

/** The probe texts are FIXED: their own bytes are part of every measurement, so they never vary. */
function probeSource(entry: string, exported: string | null): string {
  const from = JSON.stringify(entry)
  return exported === null
    ? `import * as surface from ${from}\nglobalThis.__budget = surface\n`
    : `import { ${exported} } from ${from}\nglobalThis.__budget = ${exported}\n`
}

/** Bundled bytes of one probe. Throws on a failed build — a measurement that cannot fail is noise. */
export async function measure(
  fixture: string,
  subpath: string,
  entry: string,
  exported: string | null,
): Promise<number> {
  const name = `probe-${subpath.replace(/[^a-z0-9]+/giu, '_')}-${exported ?? 'all'}.js`
  const probe = join(fixture, name)
  writeFileSync(probe, probeSource(entry, exported))
  const built = await Bun.build({
    entrypoints: [probe],
    plugins: [externalizeDependencies],
    target: 'browser',
    minify: true,
    throw: false,
  })
  if (!built.success || built.outputs.length !== 1) {
    throw new Error(
      `measuring ${subpath}${exported === null ? '' : ` { ${exported} }`} failed:\n` +
        built.logs.map(String).join('\n'),
    )
  }
  return built.outputs[0].size
}

/**
 * Is this emitted module nothing but re-exports? Those are the barrels, and the only entries where a
 * single-named-import probe says anything: for a module with code of its own, "one import" and "the
 * whole module" are the same graph.
 */
export function reExportsOnly(code: string): boolean {
  const statements = code.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
  return (
    statements
      .replace(/export\s*(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*(['"])[^'"]+\1\s*;?/gu, '')
      .trim() === ''
  )
}

/** Every name a barrel re-exports, as consumers spell it (`b` in `export { a as b }`). */
export function reExportedNames(code: string): string[] {
  return [...code.matchAll(/export\s*\{([^}]*)\}\s*from/gu)]
    .flatMap(([, names]) => names.split(','))
    .map(
      (name) =>
        name
          .trim()
          .split(/\s+as\s+/u)
          .at(-1)
          ?.trim() ?? '',
    )
    .filter((name) => name !== '')
    .sort()
}

export interface Measured {
  readonly subpath: string
  readonly bytes: number
  readonly shake?: { readonly export: string; readonly bytes: number }
}

/**
 * Weigh every published subpath, plus — for each barrel — the cost of ONE named import from it.
 *
 * `witness` supplies the export name already pinned for a barrel, so the single-import number stays
 * comparable run to run. A barrel with no pin takes the first name it publishes: any single export
 * answers the only question being asked.
 */
export async function measureSubpaths(
  witness: (subpath: string) => string | undefined,
): Promise<Measured[]> {
  ensureDistBuilt()
  const fixture = fixtureDist()
  try {
    const measured: Measured[] = []
    for (const [subpath, entry] of Object.entries(readExportMap())) {
      const declared = (entry as { import?: string }).import
      // Shape is the export-map guard's subject; here a malformed entry is simply not measurable.
      if (typeof declared !== 'string') continue
      const file = join(fixture, declared.slice(2))
      const bytes = await measure(fixture, subpath, file, null)
      const code = readFileSync(file, 'utf8')
      const names = reExportsOnly(code) ? reExportedNames(code) : []
      const pinned = witness(subpath)
      const exported = pinned !== undefined && names.includes(pinned) ? pinned : (names[0] ?? null)
      if (exported === null) {
        measured.push({ subpath, bytes })
        continue
      }
      const shake = { export: exported, bytes: await measure(fixture, subpath, file, exported) }
      measured.push({ subpath, bytes, shake })
    }
    return measured
  } finally {
    // Also on the throwing path: the error carries the build log, and one stale copy of dist per
    // failed run is how a tmpdir fills up.
    rmSync(fixture, { recursive: true, force: true })
  }
}

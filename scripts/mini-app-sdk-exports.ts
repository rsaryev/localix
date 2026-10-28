/**
 * The one reader of `@localixai/mini-app-sdk`'s export map.
 *
 * ~11 bundled mini apps and every mini-app-facing surface in `apps/ui` compile against that map,
 * and it is ~32 subpaths of HAND-WRITTEN JSON pointing into a `dist` nobody reviews. The build is a
 * bare `tsc --project tsconfig.build.json`: there is no bundler entry list, so nothing anywhere
 * derives the map from the tree or the tree from the map. Two failures follow, and both are silent:
 *
 *   1. a subpath points at a `dist` path that is never emitted — `import` resolves to a 404 in every
 *      consumer that isn't running out of a stale build directory, and
 *   2. `types` and `import` drift apart, so a mini app type-checks against one module and runs
 *      another.
 *
 * Neither shows up in `tsc --noEmit`, which reads `src` and never opens the manifest.
 *
 * Both guards that read this — `mini-app-sdk-exports-guard.test.ts` and `mini-app-sdk-bytes-guard.test.ts`
 * — measure the BUILT output, so the honest question is what to do when `dist` is absent. They
 * BUILD it (see `ensureDistBuilt`) rather than skipping: a skipped guard is a guard that reports
 * clean, and on a fresh clone — the one place where a broken export map is most likely and least
 * observed — `dist` is always absent. Skipping there would mean the check never runs in the only
 * situation it exists for.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const repoRoot = resolve(import.meta.dir, '..')
export const sdkRoot = join(repoRoot, 'packages/mini-app-sdk')
export const sdkManifestPath = join(sdkRoot, 'package.json')

/** The raw `exports` object, exactly as written — validating it is the point, so nothing is coerced. */
export type ExportMap = Readonly<Record<string, unknown>>

export function readExportMap(): ExportMap {
  const manifest = JSON.parse(readFileSync(sdkManifestPath, 'utf8')) as { exports?: unknown }
  const map = manifest.exports
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(
      `packages/mini-app-sdk/package.json has no \`exports\` object. Every guard over the SDK's public ` +
        'surface reads it; without one there is no public surface to check.',
    )
  }
  return map as ExportMap
}

/** `./dist/ui/index.js` → the absolute path it claims. */
export function sdkPath(declared: string): string {
  return join(sdkRoot, declared.slice(2))
}

/**
 * The `src` modules a `dist/<base>.js` could have been emitted from. `tsc` erases the distinction
 * between `.ts` and `.tsx` on the way out, so both are candidates and exactly one should exist.
 */
function sourceCandidates(base: string): string[] {
  return [`src/${base}.ts`, `src/${base}.tsx`]
}

/**
 * Every way the export map can be wrong, named. Empty means the map and the tree agree.
 *
 * Order matters: shape before existence, so a planted control ("a subpath pointing at a test
 * module") is reported for the reason it was planted rather than for the file happening to be
 * absent. Callers pass the map in, which is what lets the positive control push a mutated copy
 * through this exact function instead of a paraphrase of it.
 */
export function exportMapProblems(map: ExportMap): string[] {
  const problems: string[] = []
  for (const [subpath, entry] of Object.entries(map)) {
    const at = `exports["${subpath}"]`
    if (subpath !== '.' && !subpath.startsWith('./')) {
      problems.push(
        `${at}: a subpath key must be "." or start with "./" — Node reads nothing else.`,
      )
      continue
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(
        `${at}: must be a { types, import } condition object, got ${JSON.stringify(entry)}. ` +
          'A bare string ships no types, and every consumer of this SDK is TypeScript.',
      )
      continue
    }
    // `@localixai/source` leads the map: the type-check reads `src`, everything else reads `dist`.
    const sourceEntry = (entry as Record<string, unknown>)['@localixai/source']
    if (sourceEntry !== undefined) {
      if (
        typeof sourceEntry !== 'string' ||
        !sourceEntry.startsWith('./src/') ||
        !existsSync(join(sdkRoot, sourceEntry))
      ) {
        problems.push(`${at}: "@localixai/source" must name an existing module under ./src/.`)
        continue
      }
    }
    const conditions = Object.keys(entry as Record<string, unknown>).filter(
      (condition) => condition !== '@localixai/source',
    )
    if (conditions.join(',') !== 'types,import') {
      problems.push(
        `${at}: conditions are [${conditions.join(', ')}] — must be exactly ["types", "import"], in ` +
          'that order. Export conditions resolve first-match-wins, so a "types" written after ' +
          '"import" is never the one tsc reads.',
      )
      continue
    }
    const declaredTypes = (entry as Record<string, unknown>).types
    const declaredImport = (entry as Record<string, unknown>).import
    if (typeof declaredTypes !== 'string' || typeof declaredImport !== 'string') {
      problems.push(`${at}: both "types" and "import" must be strings.`)
      continue
    }
    if (!declaredImport.startsWith('./dist/') || !declaredTypes.startsWith('./dist/')) {
      problems.push(
        `${at}: both conditions must point into ./dist/ — got "${declaredTypes}" and ` +
          `"${declaredImport}". \`files\` publishes dist only, so a src path resolves for nobody ` +
          'outside this checkout.',
      )
      continue
    }
    if (!declaredImport.endsWith('.js') || !declaredTypes.endsWith('.d.ts')) {
      problems.push(
        `${at}: "types" must end in .d.ts and "import" in .js — got "${declaredTypes}" and ` +
          `"${declaredImport}".`,
      )
      continue
    }
    const base = declaredImport.slice('./dist/'.length, -'.js'.length)
    if (declaredTypes.slice('./dist/'.length, -'.d.ts'.length) !== base) {
      problems.push(
        `${at}: "types" and "import" name DIFFERENT modules ("${declaredTypes}" vs ` +
          `"${declaredImport}"). A mini app would type-check against one file and run another.`,
      )
      continue
    }
    if (/(^|\/|\.)test(\.|$)/.test(base)) {
      problems.push(
        `${at}: points at the test module "${declaredImport}". \`files\` excludes ` +
          'dist/**/*.test.* from the tarball, so this subpath resolves here and 404s once published.',
      )
      continue
    }
    for (const declared of [declaredTypes, declaredImport]) {
      if (!existsSync(sdkPath(declared))) {
        problems.push(
          `${at}: "${declared}" is not emitted. The build is \`tsc --project tsconfig.build.json\` ` +
            `over src/**, so either src/${base}.ts(x) does not exist or this path is a typo.`,
        )
      }
    }
    const source = sourceCandidates(base).filter((candidate) =>
      existsSync(join(sdkRoot, candidate)),
    )
    if (source.length === 0) {
      problems.push(
        `${at}: no source module behind it — expected one of ${sourceCandidates(base).join(' or ')}. ` +
          'A subpath whose source is gone is a stale entry kept alive by a stale dist.',
      )
    }
  }
  return problems
}

/** Newest mtime under `dir`, over the files matching `keep`. `0` when the tree is absent. */
function newestMtime(dir: string, keep: (name: string) => boolean): number {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let newest = 0
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.turbo') continue
    const full = join(dir, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    const mtime = stat.isDirectory() ? newestMtime(full, keep) : keep(entry) ? stat.mtimeMs : 0
    if (mtime > newest) newest = mtime
  }
  return newest
}

/**
 * Guarantee `dist` exists and is not older than `src`, by running the package's OWN build script —
 * so there is one definition of how this package is built, and a guard can never be measuring
 * output that a different `tsc` invocation produced.
 *
 * Returns what it had to do, which the guards assert on so a green run says which world it ran in.
 */
export function ensureDistBuilt(): 'present' | 'rebuilt' {
  const dist = join(sdkRoot, 'dist')
  const emitted = newestMtime(dist, (name) => name.endsWith('.js'))
  const sources = newestMtime(join(sdkRoot, 'src'), (name) => /\.tsx?$/.test(name))
  if (emitted > 0 && emitted >= sources) return 'present'

  const built = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: sdkRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (built.exitCode !== 0) {
    throw new Error(
      `\`bun run --cwd packages/mini-app-sdk build\` failed, so there is no dist to check the export ` +
        `map against:\n${built.stdout.toString()}\n${built.stderr.toString()}`,
    )
  }
  return 'rebuilt'
}

/** Every emitted module, repo-relative-ish (`ui/index.js`), for guards that read the output tree. */
export function emittedFiles(): string[] {
  const dist = join(sdkRoot, 'dist')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : [full.slice(dist.length + 1)]
    })
  return existsSync(dist) ? walk(dist) : []
}

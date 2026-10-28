import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { isPathWithin } from '../lib/paths'

const FILE_IMPORT = /^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/]|file:)/iu

function packageName(specifier: string): string | null {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 && parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : null
  }
  return parts[0] || null
}

async function installedPackageRoot(from: string, name: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    const root = await fs.realpath(candidate).catch(() => null)
    if (root && (await fs.stat(root)).isDirectory()) return root
    if (dir === dirname(dir)) return null
  }
}

/**
 * Verify Bun's resolved graph before writing or publishing a user mini app build. Intercepting
 * relative imports with onResolve changes Bun's tree shaking (a single icon then bundles every
 * icon), so inspect the metafile after Bun resolves static and literal dynamic imports itself.
 *
 * The defect this stops is a mini app FILE reaching out of its directory (`../../secret`). A
 * dependency is not that: Bun installs workspace dependencies hoisted into the repository's
 * `node_modules` (or links a workspace package from `packages/`), so a bare `@tanstack/…` import
 * legitimately resolves outside the mini app. Rejecting every outside input took the UI of every
 * bundled mini app with a dependency down. So an input is admitted when it is the mini app's, the
 * kit's, or reached from a mini app file through a bare specifier that resolves into its actual
 * node_modules package. That package's own graph is trusted the way the kit's is. A tsconfig
 * alias spelled like a package does not earn that trust when it points at an arbitrary file.
 */
export async function assertContainedBuildInputs(input: {
  metafile: Bun.BuildMetafile | undefined
  miniAppDir: string
  kitDir: string
  virtualInputs?: ReadonlySet<string>
  sharedSpecifiers?: ReadonlySet<string>
  /** The build's working directory, which the metafile's paths are relative to. */
  cwd?: string
}): Promise<void> {
  const { metafile, virtualInputs } = input
  const base = input.cwd ?? process.cwd()
  const at = (path: string) => resolve(base, path)
  if (!metafile) throw new Error('The mini app build returned no import graph to validate')
  const [miniAppRoot, kitRoot] = await Promise.all([
    fs.realpath(input.miniAppDir),
    fs.realpath(input.kitDir),
  ])
  const inputs = metafile.inputs

  const miniAppFiles: string[] = []
  const outside = new Set<string>()
  // An edge to walk: the import's recorded path and the directory of the file that made it.
  type Edge = { path: string; from: string }
  const edgesOf = (key: string): Edge[] =>
    (inputs[key]?.imports ?? []).map((imported) => ({
      path: imported.path,
      from: dirname(at(key)),
    }))
  // An import's recorded path is relative to the build's working directory (as Bun 1.4 records
  // it), usually another input's key. A module the bundle reached only through re-exports, such as
  // a package's `dist/index.js` barrel, is recorded the same way but is no input of its own, so a
  // recorded path that names a file there is that file too. Only anything else is a specifier,
  // resolved from the importing file.
  const realOf = async ({ path, from }: Edge) => {
    try {
      return await fs.realpath(
        path in inputs || (!FILE_IMPORT.test(path) && (await Bun.file(at(path)).exists()))
          ? at(path)
          : FILE_IMPORT.test(path)
            ? resolve(from, path)
            : Bun.resolveSync(path, from),
      )
    } catch {
      return undefined
    }
  }
  // The kit's graph is trusted, so whatever it imports is admitted too.
  const packageEntries: Edge[] = []
  await Promise.all(
    Object.keys(inputs).map(async (key) => {
      if (virtualInputs?.has(key)) return
      const realFile = await fs.realpath(at(key))
      if (isPathWithin(miniAppRoot, realFile)) miniAppFiles.push(key)
      else if (isPathWithin(kitRoot, realFile)) packageEntries.push(...edgesOf(key))
      else outside.add(key)
    }),
  )

  await Promise.all(
    miniAppFiles.map(async (key) => {
      const file = at(key)
      for (const imported of inputs[key]!.imports) {
        const specifier = imported.original ?? imported.path
        if (input.sharedSpecifiers?.has(specifier)) continue
        if (!FILE_IMPORT.test(specifier)) {
          // A tsconfig `paths` alias is also spelled like a package. It may resolve to any file
          // outside this mini app, so trust it only when it actually lands in a package installed
          // through node_modules (workspace package symlinks included), or in the shipped kit.
          const target = await realOf({ path: imported.path, from: dirname(file) })
          if (target && !isPathWithin(miniAppRoot, target) && !isPathWithin(kitRoot, target)) {
            const name = packageName(specifier)
            const packageRoot = name && (await installedPackageRoot(dirname(file), name))
            if (!packageRoot || !isPathWithin(packageRoot, target)) {
              throw new Error(
                `${key} imports "${specifier}" outside the mini app and its shipped kit`,
              )
            }
          }
          packageEntries.push({ path: imported.path, from: dirname(file) })
          continue
        }
        if (/^file:/iu.test(specifier)) {
          throw new Error(`${key} imports "${specifier}" outside the mini app`)
        }
        // A dynamic import's metafile path names its emitted chunk; original retains its source
        // specifier, so resolve that with Bun rather than inferring from the output path.
        const resolved = Bun.resolveSync(specifier, dirname(file))
        const realTarget = await fs.realpath(resolved)
        if (!isPathWithin(miniAppRoot, realTarget)) {
          throw new Error(`${key} imports "${specifier}" outside the mini app`)
        }
      }
    }),
  )

  // Trust is granted per PACKAGE, not per file: a bare edge admits the whole directory of the
  // package it lands in (the nearest `package.json`). A file-level match is not enough — inside a
  // package an import stays a bare specifier (`zustand/vanilla`) whose export conditions Bun
  // resolved differently than a later `resolveSync` would, and a workspace package is reached
  // through a symlink (`node_modules/@localixai/x` → `packages/x`), so paths are compared real.
  // An external (`react`) is bundled by nobody, and trusting its directory admits no input.
  const packageRootOf = async (file: string) => {
    for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
      if (await Bun.file(resolve(dir, 'package.json')).exists()) return dir
    }
    return undefined
  }
  const realKeys = await Promise.all(
    [...outside].map(async (key) => ({ key, real: await fs.realpath(at(key)) })),
  )
  const trustedRoots = new Set<string>()
  const pending = [...packageEntries]
  while (pending.length > 0) {
    const edge = pending.pop()!
    const real = await realOf(edge)
    const root = real === undefined ? undefined : await packageRootOf(real)
    // The mini app's own package.json is never a dependency root.
    if (root === undefined || trustedRoots.has(root) || isPathWithin(miniAppRoot, root)) continue
    trustedRoots.add(root)
    for (const { key, real: file } of realKeys) {
      if (outside.has(key) && isPathWithin(root, file)) {
        outside.delete(key)
        pending.push(...edgesOf(key))
      }
    }
  }

  const [stray] = outside
  if (stray !== undefined) throw new Error(`${stray} is outside the mini app and its shipped kit`)
}

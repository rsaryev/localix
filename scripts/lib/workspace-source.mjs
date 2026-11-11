// How development reads the workspace's own packages: from their `src`, never their `dist`.
//
// Every workspace package publishes its source under the `@localixai/source` export condition
// (beside `import` → `dist`). Type checks already resolve through it (`customConditions`); the dev
// API (`scripts/dev-api.mjs`, `bun --conditions`) and the Vite dev server (`apps/ui/vite.config.ts`,
// `resolve.conditions`) do too, so a package build — a `tsc --watch` re-emit, a Turbo cache restore,
// a test that rebuilds `dist` — never restarts the API or reloads the page, and dev needs no build
// before it starts. Callers: `scripts/dev-api.mjs`, `apps/ui/vite.config.ts`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOURCE_CONDITION = '@localixai/source'

// What a package needs at run time; its devDependencies (test helpers, tooling) are not loaded.
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

/** Package name → directory, for every workspace package of `repo`. */
function workspacePackages(repo) {
  const packages = new Map()
  for (const pattern of readManifest(repo).workspaces ?? []) {
    for (const manifest of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: repo })) {
      const dir = join(repo, manifest, '..')
      packages.set(readManifest(dir).name, dir)
    }
  }
  return packages
}

/**
 * The `src` directory of every workspace package that `packageDir` (relative to `repo`) depends
 * on, directly or through another workspace package, sorted. Only `workspace:` dependencies count.
 */
export function workspaceSourceRoots(repo, packageDir) {
  const packages = workspacePackages(repo)
  const reached = new Set()
  const visit = (dir) => {
    const manifest = readManifest(dir)
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        const dependency = packages.get(name)
        if (!String(range).startsWith('workspace:') || !dependency || reached.has(dependency)) {
          continue
        }
        reached.add(dependency)
        visit(dependency)
      }
    }
  }
  visit(join(repo, packageDir))
  reached.delete(join(repo, packageDir))
  return [...reached].sort((a, b) => a.localeCompare(b)).map((dir) => join(dir, 'src'))
}

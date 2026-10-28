import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// Hooks must work before packages have been built; reuse the owner's source implementation.
import { isPathBelow } from '../packages/path-containment/src/index.ts'

const source = /\.[cm]?[jt]sx?$/
const testFile = /\.(?:dom\.)?test\.[cm]?[jt]sx?$/

export const isInWorkspace = (workspace, path) => isPathBelow(workspace.path, path)

export function readWorkspaces(root) {
  const manifest = join(root, 'package.json')
  if (!existsSync(manifest)) return []
  const { workspaces = [] } = JSON.parse(readFileSync(manifest, 'utf8'))
  return workspaces.flatMap((pattern) =>
    [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root })].map((path) => {
      const pkg = JSON.parse(readFileSync(join(root, path), 'utf8'))
      return {
        path: path.slice(0, -'/package.json'.length),
        name: pkg.name,
        scripts: pkg.scripts ?? {},
        dependencies: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }),
      }
    }),
  )
}

/** What a commit of `paths` checks: the tests beside them, and Rust when the shell changed. */
export function planChecks(paths, exists = existsSync) {
  const tests = new Set()
  for (const path of paths.filter((path) => source.test(path))) {
    if (testFile.test(path)) {
      if (exists(path)) tests.add(path)
      continue
    }
    const stem = path.replace(source, '')
    for (const suffix of ['.test.ts', '.test.tsx', '.dom.test.tsx']) {
      if (exists(`${stem}${suffix}`)) tests.add(`${stem}${suffix}`)
    }
  }
  return {
    tests: [...tests],
    rust: paths.some(
      (path) =>
        isPathBelow('apps/desktop-tauri/src-tauri', path) && /\.(?:rs|toml|lock|json)$/.test(path),
    ),
  }
}

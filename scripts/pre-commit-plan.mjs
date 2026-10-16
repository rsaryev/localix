import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// Hooks must work before packages have been built; reuse the owner's source implementation.
import { isPathBelow } from '../packages/path-containment/src/index.ts'

const source = /\.[cm]?[jt]sx?$/
const testFile = /\.(?:dom\.)?test\.[cm]?[jt]sx?$/
const globalTypes = /^(?:package\.json|bun\.lock|turbo\.json|tsconfig[^/]*\.json)$/

export const isInWorkspace = (workspace, path) => isPathBelow(workspace.path, path)
export const isGlobalTypeInput = (path) => globalTypes.test(path)

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

export function planChecks(paths, workspaces, exists = existsSync) {
  const selected = new Set()
  const allTypes = paths.some(isGlobalTypeInput)
  for (const workspace of workspaces) {
    if (
      allTypes ||
      paths.some(
        (path) => isInWorkspace(workspace, path) && /\.(?:[cm]?[jt]sx?|jsonc?)$/.test(path),
      )
    ) {
      selected.add(workspace.name)
    }
  }
  // The API includes bundled plugin backends in its compile project.
  if (paths.some((path) => /^plugins\/.*\/backend\/.*\.[cm]?[jt]sx?$/.test(path))) {
    for (const workspace of workspaces) {
      if (workspace.path === 'apps/api') selected.add(workspace.name)
    }
  }
  // A shared contract can break a consumer even when the consumer has no staged edits.
  let previousSize
  do {
    previousSize = selected.size
    for (const workspace of workspaces) {
      if (workspace.dependencies.some((name) => selected.has(name))) selected.add(workspace.name)
    }
  } while (selected.size !== previousSize)

  const typed = workspaces
    .filter((workspace) => selected.has(workspace.name))
    .filter((workspace) => workspace.scripts['type-check'] || workspace.scripts['type-check:tests'])
  // Turbo also reads upstream build inputs; an unstaged dependency repair must not mask a failure.
  const checked = new Set(selected)
  do {
    previousSize = checked.size
    for (const workspace of workspaces) {
      if (checked.has(workspace.name)) {
        for (const name of workspace.dependencies) checked.add(name)
      }
    }
  } while (checked.size !== previousSize)
  const affected = workspaces.filter((workspace) => checked.has(workspace.name))
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
    typed,
    affected,
    allTypes,
    tests: [...tests],
    rust: paths.some(
      (path) =>
        isPathBelow('apps/desktop-tauri/src-tauri', path) && /\.(?:rs|toml|lock|json)$/.test(path),
    ),
  }
}

import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// A workspace that reads another workspace's files through tsconfig `paths` must hash them into
// its type-check cache key: either the target is a workspace the task depends on (a dependency in
// package.json, or a `<name>#type-check` entry in `dependsOn`), or the task's `inputs` cover it.
// Otherwise Turbo replays a stale "passed" after the target changes.

const root = resolve(import.meta.dir, '..')
type Json = Record<string, any>
// JSONC: comments are dropped, but only outside strings (a glob such as "src/**/*" holds `/*`).
const readJson = (path: string): Json =>
  JSON.parse(
    readFileSync(path, 'utf8')
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? '')
      .replace(/,(\s*[}\]])/g, '$1'),
  )

const workspaces = ['apps', 'packages', 'mini-apps', 'plugins'].flatMap((group) =>
  existsSync(join(root, group))
    ? readdirSync(join(root, group))
        .map((name) => join(root, group, name))
        .filter((dir) => existsSync(join(dir, 'package.json')))
    : [],
)
const nameOf = new Map(workspaces.map((dir) => [dir, readJson(join(dir, 'package.json')).name]))
const rootTasks: Json = readJson(join(root, 'turbo.json')).tasks

function effective(dir: string, task: string, field: 'dependsOn' | 'inputs'): string[] {
  const own = existsSync(join(dir, 'turbo.json')) ? readJson(join(dir, 'turbo.json')).tasks : {}
  return own?.[task]?.[field] ?? rootTasks[task]?.[field] ?? []
}

function pathsOf(configFile: string): string[] {
  const config = readJson(configFile)
  const targets = Object.values((config.compilerOptions?.paths ?? {}) as Record<string, string[]>)
  return targets.flat().map((target) => resolve(dirname(configFile), target.replace(/\*.*$/, '')))
}

const configsOf = (dir: string) =>
  readdirSync(dir)
    .filter((file) => /^tsconfig.*\.json$/.test(file))
    .map((file) => join(dir, file))

function covered(dir: string, task: string, target: string): boolean {
  const owner = workspaces.find((w) => target === w || target.startsWith(w + '/'))
  if (!owner || owner === dir) return true
  const pkg = readJson(join(dir, 'package.json'))
  const name = nameOf.get(owner)
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  if (declared[name]) return true
  if (effective(dir, task, 'dependsOn').includes(`${name}#${task}`)) return true
  const ownerPath = relative(root, target)
  return effective(dir, task, 'inputs').some((input: string) => {
    if (!input.startsWith('$TURBO_ROOT$/')) return false
    const glob = input.slice('$TURBO_ROOT$/'.length).replace(/\/\*\*.*$/, '')
    return ownerPath === glob || ownerPath.startsWith(glob + '/')
  })
}

describe('type-check cache keys', () => {
  for (const dir of workspaces) {
    const scripts = readJson(join(dir, 'package.json')).scripts ?? {}
    for (const task of ['type-check', 'type-check:tests'].filter((t) => scripts[t])) {
      test(`${relative(root, dir)} ${task} hashes every file its tsconfig paths read`, () => {
        const uncovered = configsOf(dir)
          .flatMap(pathsOf)
          .filter((target) => !covered(dir, task, target))
          .map((target) => relative(root, target))
        expect(uncovered).toEqual([])
      })
    }
  }
})

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import type { CheckOutputs } from '../check/check'
import { MANIFEST_FILE } from '../check/check'

/**
 * A mini app's PACKAGE: the folder Localix installs and a catalog archive holds. `mini-app.json`
 * at its root naming the built backend, the agent's guide, the store media and every other file the
 * app ships, and `dist/` with the backend bundle and the UI artifact. Built code only: the sources
 * the bundles absorbed, the tests and the authoring files stay behind.
 *
 * It is written to `<app>/dist/package` and swapped in whole, so a reader never sees half of one.
 */

export const PACKAGE_DIR = join('dist', 'package')

/** Authoring files and folders no package carries, by name, at the root of the app's folder. */
const LEFT_BEHIND = new Set([
  'node_modules',
  'dist',
  'tmp',
  'preview',
  'bun.lock',
  'bunfig.toml',
  'package.json',
  'tsconfig.json',
  'tsconfig.tests.json',
  'vite.config.ts',
  'AGENTS.md',
  'KIT.md',
  'CLAUDE.md',
])
const TEST_FILE = /\.test\.[a-z]+$/u
/** Sources the bundles absorb; one the manifest names itself (an options script) is kept. */
const SOURCE_FILE = /\.(?:[cm]?tsx?|jsx)$/u

/** Every `./`-relative string the manifest names outside `backend`: files the app reads at runtime. */
function declaredFiles(manifest: Record<string, unknown>): Set<string> {
  const found = new Set<string>()
  const visit = (value: unknown, key?: string) => {
    if (key === 'backend') return
    if (typeof value === 'string') {
      if (value.startsWith('./')) found.add(value.slice(2))
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
    }
  }
  visit(manifest)
  return found
}

async function copyShipped(
  from: string,
  to: string,
  declared: ReadonlySet<string>,
  root: string = from,
): Promise<void> {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (from === root && LEFT_BEHIND.has(entry.name))) continue
    const source = join(from, entry.name)
    const rel = relative(root, source).split(sep).join('/')
    if (entry.isDirectory()) {
      await copyShipped(source, join(to, entry.name), declared, root)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`${rel} is not a regular file; a mini app package holds only files`)
    }
    if (rel === MANIFEST_FILE || TEST_FILE.test(entry.name)) continue
    if (SOURCE_FILE.test(entry.name) && !declared.has(rel)) continue
    await fs.mkdir(to, { recursive: true })
    await fs.copyFile(source, join(to, entry.name))
  }
}

/** Assemble the package from the app's folder and a passing check's outputs, then swap it in. */
export async function assemblePackage(miniAppDir: string, outputs: CheckOutputs): Promise<string> {
  const target = join(miniAppDir, PACKAGE_DIR)
  const next = join(dirname(target), `.package-${randomUUID()}`)
  try {
    await copyShipped(miniAppDir, next, declaredFiles(outputs.manifest))
    const built = join(outputs.dir, 'dist')
    if (await fs.stat(built).catch(() => null))
      await fs.cp(built, join(next, 'dist'), { recursive: true })
    const manifest = { ...outputs.manifest }
    if (outputs.backend) manifest.backend = outputs.backend
    else delete manifest.backend
    await fs.mkdir(next, { recursive: true })
    await fs.writeFile(join(next, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)

    const previous = join(dirname(target), `.package-previous-${randomUUID()}`)
    const hadPrevious = await fs.rename(target, previous).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        // Only "there is no package yet" is fine; a permission or busy failure must surface.
        if (error.code === 'ENOENT') return false
        throw error
      },
    )
    try {
      await fs.rename(next, target)
    } catch (error) {
      if (hadPrevious) await fs.rename(previous, target)
      throw error
    }
    if (hadPrevious) await fs.rm(previous, { recursive: true, force: true })
  } finally {
    await fs.rm(next, { recursive: true, force: true })
  }
  return target
}

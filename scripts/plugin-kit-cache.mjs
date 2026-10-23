import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'

/**
 * A content-addressed cache of staged plugin kits, for development and the repository's tests.
 *
 * Every `bun run dev` staged the kit from scratch into a new per-PID tree: a `tsc` over the kit's
 * declarations plus a backend bundle, measured at up to 333% CPU and 1.5GB for ~3s of every
 * launch, for a kit whose inputs had not changed since the last one. The suites that load a kit
 * (`plugin-kit.integration.test.ts`, `plugin-ui-artifact.test.ts`) paid the same on every run — an agent
 * re-running one three times in thirty seconds kept three cores busy for nothing. The kit holds no
 * absolute paths (packaging already relocates it), so a kit staged once is valid wherever the
 * inputs are the same; a change to staging itself changes the key, so a test still stages fresh
 * exactly when what it tests changed.
 *
 * Keyed by CONTENT, not mtime: `turbo dev` starts `tsc --watch` for a package whose `dist` is a
 * kit input, and its initial emit rewrites that `dist` with identical bytes on every launch — an
 * mtime key would miss every time.
 */

/** Kits kept besides the current one; each is ~33MB. */
const KEEP = 2

/**
 * Inputs of the KEY beyond the kit's own sources: the kit copies vendor packages and the SDK's
 * dependencies out of `node_modules`, which `bun.lock` pins, and this module decides what a hit is.
 */
const KEY_EXTRA_INPUTS = ['bun.lock', 'scripts/plugin-kit-cache.mjs']

/** The one cache every caller shares: dev launches, the dev watcher and the test suites. */
export function kitCacheRoot(repoRoot) {
  return join(repoRoot, '.turbo', 'plugin-kit-cache')
}

/** Digest of every file under `inputs` (repository-relative), plus the runtime that stages. */
export function kitInputsDigest(repoRoot, inputs) {
  const hash = createHash('sha256')
  const visit = (path) => {
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry === 'node_modules' || entry === '.turbo') continue
        visit(join(path, entry))
      }
      return
    }
    hash
      .update(`${relative(repoRoot, path)}\0`)
      .update(readFileSync(path))
      .update('\0')
  }
  for (const input of [...inputs, ...KEY_EXTRA_INPUTS]) {
    const path = join(repoRoot, input)
    if (existsSync(path)) visit(path)
  }
  hash.update(`${process.platform}:${process.arch}:${Bun.version}`)
  return hash.digest('hex').slice(0, 32)
}

/** The cached kit for `digest`, or null. A kit is cached only once complete (`manifest`). */
export function cachedKit(cacheRoot, digest, manifest) {
  const dir = join(cacheRoot, digest)
  return existsSync(join(dir, manifest)) ? dir : null
}

/** Store a freshly staged kit under `digest` (swapped in whole), and drop the oldest others. */
export function storeKit(cacheRoot, digest, stagedKit) {
  const target = join(cacheRoot, digest)
  const scratch = `${target}.tmp-${process.pid}`
  rmSync(scratch, { recursive: true, force: true })
  cpSync(stagedKit, scratch, { recursive: true })
  rmSync(target, { recursive: true, force: true })
  renameSync(scratch, target)
  const others = readdirSync(cacheRoot)
    .filter((name) => name !== digest && /^[0-9a-f]{32}$/u.test(name))
    .map((name) => ({ name, at: statSync(join(cacheRoot, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  for (const { name } of others.slice(KEEP)) {
    rmSync(join(cacheRoot, name), { recursive: true, force: true })
  }
}

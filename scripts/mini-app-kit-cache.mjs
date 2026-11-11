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
 * A content-addressed cache of staged mini app kits, for development and the repository's tests.
 *
 * Every `bun run dev` staged the kit from scratch into a new per-PID tree: a `tsc` over the kit's
 * declarations plus a backend bundle, measured at up to 333% CPU and 1.5GB for ~3s of every
 * launch, for a kit whose inputs had not changed since the last one. The suites that load a kit
 * (`mini-app-kit.integration.test.ts`, `mini-app-ui-artifact.test.ts`) paid the same on every run —
 * an agent re-running one three times in thirty seconds kept three cores busy for nothing. The kit
 * holds no absolute paths (packaging already relocates it), so a kit staged once is valid wherever
 * the inputs are the same; a change to staging itself changes the key, so a test still stages fresh
 * exactly when what it tests changed.
 *
 * Keyed by CONTENT, not mtime: a package build rewrites a `dist` that is a kit input with identical
 * bytes (a Turbo cache restore, a test rebuilding `dist`), and an mtime key would miss every time.
 */

/** Kits kept besides the current one; each is ~33MB. */
const KEEP = 2

/**
 * Inputs of the KEY beyond the kit's own sources: the kit copies vendor packages and the SDK's
 * dependencies out of `node_modules`, which `bun.lock` pins, and this module decides what a hit is.
 */
const KEY_EXTRA_INPUTS = ['bun.lock', 'scripts/mini-app-kit-cache.mjs']

/** The one cache every caller shares: `bun run mini-app-kit` and the test suites. */
export function kitCacheRoot(repoRoot) {
  return join(repoRoot, '.turbo', 'mini-app-kit-cache')
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

/** A stored kit: `<digest>`, or `<digest>-<Localix version>` as `stage-mini-app-kit.mjs` keys it. */
const KIT_ENTRY = /^[0-9a-f]{32}(?:-[0-9A-Za-z.+-]+)?$/u
/** `storeKit`'s scratch copy, named after the staging process. */
const SCRATCH_ENTRY = /\.tmp-(\d+)$/u

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Store a freshly staged kit under `digest` (swapped in whole), and drop the oldest others. */
export function storeKit(cacheRoot, digest, stagedKit) {
  const target = join(cacheRoot, digest)
  const scratch = `${target}.tmp-${process.pid}`
  rmSync(scratch, { recursive: true, force: true })
  cpSync(stagedKit, scratch, { recursive: true })
  rmSync(target, { recursive: true, force: true })
  renameSync(scratch, target)
  const names = readdirSync(cacheRoot)
  // A stager that died between the copy and the rename left its scratch copy behind.
  for (const name of names) {
    const owner = SCRATCH_ENTRY.exec(name)?.[1]
    if (owner && !processIsAlive(Number(owner))) {
      rmSync(join(cacheRoot, name), { recursive: true, force: true })
    }
  }
  const others = names
    .filter((name) => name !== digest && KIT_ENTRY.test(name) && !SCRATCH_ENTRY.test(name))
    .map((name) => ({ name, at: statSync(join(cacheRoot, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  for (const { name } of others.slice(KEEP)) {
    rmSync(join(cacheRoot, name), { recursive: true, force: true })
  }
}

import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { sourceTree } from '@localixai/source-lint'

/**
 * Vendored upstream stays upstream, and it stays the size it is.
 *
 * `vendor/` holds reviewed snapshots of code we do not write: the Monaco runtime and the Pi agent
 * workspaces. `check:vendor` already proves the manifests are wired, that no full upstream Git repo
 * came along, and that the formatter, linter and knip all skip the tree. Two things it does not
 * prove, and both fail silently:
 *
 * ONE — the seam. First-party code reaches the Pi packages through exactly one adapter,
 * `packages/agent-runtime-pi`, which is what makes an upstream update a change to one module rather
 * than an archaeology exercise across the API. Tests included: an exempt test is all it takes for
 * a workspace to keep the dependency declared, and a declared dependency is one import away from
 * upstream's shape spreading into ours.
 *
 * TWO — the weight. A snapshot is refreshed by copying a new upstream in, and a runtime that
 * doubled would pass every existing check: the required-file list says what must be PRESENT, never
 * how much may arrive with it. 28 MB of Monaco ships in the desktop bundle.
 *
 * Budgets are ceilings with headroom, not pins — refreshing a snapshot is normal and should not
 * need a baseline edit. Crossing one means reading what arrived.
 */

const repoRoot = resolve(import.meta.dir, '..')

/** The one module allowed to import the vendored Pi packages. */
const PI_ADAPTER = 'packages/agent-runtime-pi/'
/** Vendored package scopes that production code may not reach directly. */
const VENDORED_SPECIFIER = /@earendil-works\/pi-[a-z-]+/u

interface Budget {
  readonly path: string
  readonly maxBytes: number
  readonly maxFiles: number
  /** Why this ceiling, and what to do when it is crossed. */
  readonly note: string
}

const BUDGETS: readonly Budget[] = [
  {
    path: 'vendor/monaco-editor-runtime',
    // 28.2 MB / 1606 files at Monaco 0.56.0. The desktop bundle carries all of it.
    maxBytes: 34_000_000,
    maxFiles: 1900,
    note: 'a Monaco refresh that lands this much more is worth reading before it ships in the app',
  },
  {
    path: 'vendor/pi',
    // 6.4 MB / 655 files at pi 0.85.1, excluding build output: ai 3.1 MB, agent 2.9 MB
    // (the harness and its session backends), chord 0.4 MB, telemetry 0.1 MB.
    maxBytes: 8_500_000,
    maxFiles: 800,
    note: 'the Pi snapshot is source only; a jump this size usually means build output came along',
  },
]

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage'])

/**
 * Build OUTPUT, which legitimately contains the vendored code inlined — these are bundles, not
 * imports. The same trees are skipped by `check-architecture` for the same reason: the canonical
 * sources are scanned where they live, and a bundle is a copy of them.
 */
const BUILT_PAYLOADS = [
  'apps/desktop-tauri/src-tauri/target/',
  'apps/desktop-tauri/src-tauri/resources/',
  'packages/cli/server/',
  'packages/cli/public/',
]

function measure(directory: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (current: string) => {
    for (const entry of readdirSyncTyped(current)) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(join(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      bytes += statSync(join(current, entry.name)).size
      files += 1
    }
  }
  walk(directory)
  return { bytes, files }
}

/** Narrow wrapper so the walk reads clearly; `withFileTypes` is what makes it one stat per entry. */
function readdirSyncTyped(directory: string) {
  // eslint-disable-next-line
  return require('node:fs').readdirSync(directory, { withFileTypes: true }) as {
    name: string
    isDirectory: () => boolean
    isFile: () => boolean
  }[]
}

describe('vendored upstream boundary', () => {
  // `sourceTree` throws rather than hand back an empty list, and the witnesses make it throw if the
  // adapter or the API feature tree moves — a boundary lint that scans nothing passes forever.
  const sources = sourceTree({
    roots: [join(repoRoot, 'apps'), join(repoRoot, 'packages'), join(repoRoot, 'plugins')],
    mustInclude: [
      'packages/agent-runtime-pi/src/message-codec.ts',
      'apps/api/src/features/plugins/validate.ts',
    ],
    minFiles: 500,
    label: 'the first-party sources that could reach vendored upstream',
  })

  test('the Pi snapshot carries no archives and none of upstream’s working notes', () => {
    // The budget below is the coarse check; this is the sharp one. The sync that carried pi to
    // 59eb4c39 brought `packages/agent/docs/pico/` — design handoffs and a 312 KB zip — and
    // crossed the ceiling. `scripts/vendor-pi/config.ts` keeps that path out of every snapshot; this
    // is what fails if the prune list and the tree disagree, or if a binary arrives elsewhere.
    const pi = join(repoRoot, 'vendor/pi')
    const archives = [...new Bun.Glob('**/*.{zip,tar,tgz,gz,7z}').scanSync({ cwd: pi })].filter(
      (path) => !path.includes('node_modules/'),
    )
    expect(archives, `archives are not source:\n  ${archives.join('\n  ')}`).toEqual([])
    // eslint-disable-next-line
    const existsSync = require('node:fs').existsSync as (p: string) => boolean
    expect(existsSync(join(pi, 'packages/agent/docs/pico'))).toBe(false)
  })

  test('only the adapter imports the vendored Pi packages', () => {
    const trespassers: string[] = []
    for (const file of sources) {
      const path = relative(repoRoot, file).replaceAll('\\', '/')
      if (path.startsWith(PI_ADAPTER)) continue
      if (BUILT_PAYLOADS.some((tree) => path.startsWith(tree))) continue
      // Tests are NOT exempt. They used to be, and `apps/api` carried a dev dependency on the
      // Pi packages purely to satisfy one of them — which made the seam a convention rather
      // than a fact: any feature could have imported upstream and the build would have found
      // it. A behaviour that genuinely needs the real loop belongs in the adapter's own tests
      // (`packages/agent-runtime-pi/src/steering.test.ts`), with the host half driven through
      // the port beside it.
      if (VENDORED_SPECIFIER.test(readFileSync(file, 'utf8'))) trespassers.push(path)
    }
    expect(
      trespassers,
      trespassers.length === 0
        ? ''
        : `these reach the vendored Pi packages directly instead of through ${PI_ADAPTER}:\n  ` +
            `${trespassers.join('\n  ')}\n` +
            'Upstream shape must stay behind the adapter, so one snapshot refresh is one module to fix.',
    ).toEqual([])
  })

  test.each(BUDGETS.map((budget) => [budget.path, budget] as const))(
    '%s stays inside its budget',
    (_path, budget) => {
      const { bytes, files } = measure(join(repoRoot, budget.path))
      expect(
        bytes,
        `${budget.path}: ${bytes} bytes over ${budget.maxBytes} — ${budget.note}`,
      ).toBeLessThanOrEqual(budget.maxBytes)
      expect(
        files,
        `${budget.path}: ${files} files over ${budget.maxFiles} — ${budget.note}`,
      ).toBeLessThanOrEqual(budget.maxFiles)
      // A measurement that collapsed to nothing would satisfy both ceilings perfectly.
      expect(bytes).toBeGreaterThan(100_000)
      expect(files).toBeGreaterThan(50)
    },
  )
})

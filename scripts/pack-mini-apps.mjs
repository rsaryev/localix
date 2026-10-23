#!/usr/bin/env bun
// Build a mini app catalog: pack each app into `<out>/<name>-<version>-<hash>.tar.gz` beside
// `mini-app-catalog.json` (`docs/extending/mini-app-publishing.md`).
//
// By default it stages this checkout's `mini-apps/` exactly as a release builds it (backends
// bundled, screens built) and publishes them as Localix; the release workflow uploads the folder
// as release assets, which is the hosted catalog the store reads (`DEFAULT_MINI_APP_CATALOG_URL`).
// With `--source` it packs apps that are already built — a folder of them, or one app's folder,
// such as `~/.localix/mini-apps/<name>` after `/mini-app reload` — under `--publisher`.
//
//   bun scripts/pack-mini-apps.mjs [--out dist/mini-app-catalog] [--only chess,kanban]
//   bun scripts/pack-mini-apps.mjs --source ~/.localix/mini-apps --only notes --publisher "Ada"

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { packMiniAppCatalog } from './lib/mini-app-catalog.mjs'
import { readStagingUnavailable, stageDropins, stageMiniAppKitBeside } from './stage-dropins.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(repoRoot, 'dist', 'mini-app-catalog') },
    only: { type: 'string' },
    source: { type: 'string' },
    publisher: { type: 'string' },
  },
})
const log = (line) => console.log(`[pack-mini-apps] ${line}`)

const only = values.only?.split(',').map((name) => name.trim())

if (values.source) {
  const source = resolve(values.source)
  // One app's own folder packs as a catalog of one.
  const single = existsSync(join(source, 'mini-app.json'))
  const catalog = await packMiniAppCatalog({
    stagedRoot: single ? dirname(source) : source,
    outDir: resolve(values.out),
    // Only the hosted Localix catalog vouches for a publisher; any other catalog is unverified.
    publisher: { name: values.publisher ?? 'Unknown publisher', verified: false },
    only: single ? [JSON.parse(readFileSync(join(source, 'mini-app.json'), 'utf8')).name] : only,
    log,
  })
  log(`${catalog.apps.length} mini apps in ${resolve(values.out)}`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'localix-mini-apps-'))
try {
  const staged = join(work, 'mini-apps')
  stageMiniAppKitBeside({ repoRoot, outMiniApps: staged })
  // A release ships no app whose source does not build: skip it and say so, never fail the rest.
  stageDropins({ repoRoot, outMiniApps: staged, log, onMiniAppError: 'skip', uiSourceMaps: false })
  const catalog = await packMiniAppCatalog({
    stagedRoot: staged,
    outDir: resolve(values.out),
    unavailable: readStagingUnavailable(staged),
    // A fork packing its own app names itself; only the Localix release is vouched for.
    ...(values.publisher ? { publisher: { name: values.publisher, verified: false } } : {}),
    only,
    log,
  })
  log(`${catalog.apps.length} mini apps in ${resolve(values.out)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

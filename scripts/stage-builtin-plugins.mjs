// Stage the plugins built into Localix: every Claude Code plugin under the repository's `plugins/`
// (a folder whose manifest is `.claude-plugin/plugin.json`), copied as it is, beside the server
// bundle (`resources/builtin-plugins/`, `apps/desktop-tauri/scripts/prepare-sidecar.mjs`) or into
// the dev launcher's staging root (`scripts/dev-api.mjs`, which names it to the API with
// `LOCALIX_BUILTIN_PLUGINS_DIR`). A plugin is content in Claude Code's format, so nothing is built;
// tests and dependency folders stay behind. The same folders are what the repository's
// `.claude-plugin/marketplace.json` lists, for plain Claude Code.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { PLUGINS_DIR } from './lib/bundled-roots.mjs'
import { isClaudeCodePluginOnly } from './lib/extension-manifest.mjs'

const SKIP = new Set(['node_modules', '.turbo', 'tmp', '.DS_Store'])
const TEST_FILE = /\.test\.[a-z]+$/u

/** The built-in plugins of a checkout, by folder name. */
export function builtinPluginNames(repoRoot) {
  const root = join(repoRoot, PLUGINS_DIR)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isClaudeCodePluginOnly(join(root, entry.name)))
    .map((entry) => entry.name)
    .sort()
}

/** Copy the built-in plugins into `out` (replaced whole). Returns the names staged. */
export function stageBuiltinPlugins({ repoRoot, out }) {
  const names = builtinPluginNames(repoRoot)
  const staging = `${out}.staging-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const name of names) {
    cpSync(join(repoRoot, PLUGINS_DIR, name), join(staging, name), {
      recursive: true,
      filter: (path) => !SKIP.has(basename(path)) && !TEST_FILE.test(path),
    })
  }
  mkdirSync(dirname(out), { recursive: true })
  rmSync(out, { recursive: true, force: true })
  renameSync(staging, out)
  return names
}

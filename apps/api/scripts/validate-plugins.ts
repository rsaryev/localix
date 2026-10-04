/**
 * Fast, plain-stdout plugin validator for development — "like a compiler" for plugins.
 *
 *   bun apps/api/scripts/validate-plugins.ts              # every bundled plugin
 *   bun apps/api/scripts/validate-plugins.ts <path...>    # specific plugin dir(s)
 *   bun apps/api/scripts/validate-plugins.ts --strict     # warnings fail too
 *   bun apps/api/scripts/validate-plugins.ts --quiet      # hide clean plugins
 *   (also: `bun run validate:plugins` from apps/api)
 *
 * Reuses the CANONICAL `validatePluginFull` (manifest + commands + agents + compat +
 * SKILL.md) — the SAME function the plugin service surfaces in Settings / `/plugins`,
 * so the CLI and the app can never disagree. No validation logic is duplicated here.
 *
 * Exit code: 1 if any errors (with --strict, any warnings count), else 0 — so it drops
 * straight into a pre-commit hook or CI step.
 */
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { discoverBundledPlugins, type DiscoveredPlugin } from '../src/features/plugins/discovery'
import { loadManifest } from '../src/features/plugins/manifest-load'
import { validatePluginFull } from '../src/features/plugins/validate'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const quiet = args.includes('--quiet')
const paths = args.filter((a) => !a.startsWith('--'))

// A path that isn't a directory is a typo, not a plugin — loadManifest tolerates a
// missing manifest (CC parity) and would silently invent one named after the path, so
// guard here for a clear failure instead.
for (const p of paths) {
  let ok = false
  try {
    ok = statSync(resolve(p)).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) {
    console.error(`error: not a plugin directory: ${p}`)
    process.exit(2)
  }
}

// A path argument is validated as a standalone plugin dir (global scope, not bundled);
// no args → the whole bundled reference set. Both paths yield ordinary DiscoveredPlugins.
const plugins: DiscoveredPlugin[] = paths.length
  ? await Promise.all(paths.map((p) => loadManifest(resolve(p), 'global', '', false)))
  : await discoverBundledPlugins()

const color = !process.env.NO_COLOR && process.stdout.isTTY
const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
const red = (s: string) => paint('31', s)
const yellow = (s: string) => paint('33', s)
const green = (s: string) => paint('32', s)
const bold = (s: string) => paint('1', s)
const dim = (s: string) => paint('2', s)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

let totErr = 0
let totWarn = 0
let clean = 0

for (const plugin of plugins) {
  const { errors, warnings } = await validatePluginFull(plugin, { strict })
  totErr += errors.length
  totWarn += warnings.length
  if (errors.length === 0 && warnings.length === 0) {
    clean++
    if (!quiet) console.log(`${green('✓')} ${bold(plugin.manifest.name)} ${dim('clean')}`)
    continue
  }
  console.log(
    `\n${bold(plugin.manifest.name)} ${dim(`(${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')})`)}`,
  )
  for (const e of errors) console.log(`  ${red('✗')} ${e}`)
  for (const w of warnings) console.log(`  ${yellow('⚠')} ${w}`)
}

console.log(`\n${dim('─'.repeat(52))}`)
console.log(
  `${plural(plugins.length, 'plugin')} · ${green(`${clean} clean`)} · ` +
    `${totErr ? red(plural(totErr, 'error')) : plural(totErr, 'error')} · ` +
    (totWarn ? yellow(plural(totWarn, 'warning')) : plural(totWarn, 'warning')),
)

process.exit(totErr > 0 ? 1 : 0)

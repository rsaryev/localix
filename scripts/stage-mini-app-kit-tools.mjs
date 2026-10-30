// The mini app kit's `tools` module and its `authoring` block: what the authoring plugin
// reads to scaffold, build, check and pack a mini app the way this Localix runs one. Localix does
// not author mini apps itself; it publishes its own rules (the manifest verdict, store media, the
// house style, the route body rule, the Tailwind compiler) as one prebuilt module, so the plugin
// never imports Localix's source (docs/internals/plugins-and-mini-apps.md, X1).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The facade the kit bundles, repository-relative. */
export const KIT_TOOLS_ENTRY = 'apps/api/src/features/mini-apps/kit-tools.ts'
/** Where it lands in the kit; `.mjs` so any ES module loader reads it as one. */
export const KIT_TOOLS_FILE = 'tools/authoring.mjs'
/** The `authoring` block's contract version; the plugin refuses one it does not read. */
export const KIT_AUTHORING_VERSION = 2
/**
 * What the facade is built from, for the kit's input digest. A test bundles the facade and fails
 * on a file it absorbs that no kit input names, so this list cannot drift from the imports.
 */
export const KIT_TOOLS_INPUTS = [
  'scripts/stage-mini-app-kit-tools.mjs',
  KIT_TOOLS_ENTRY,
  'apps/api/src/features/mini-apps/folder.ts',
  'apps/api/src/features/mini-apps/revocation-file.ts',
  'apps/api/src/features/mini-apps/validate.ts',
  'apps/api/src/features/mini-apps/contracts.ts',
  'apps/api/src/features/mini-apps/contracts-base.ts',
  'apps/api/src/features/mini-apps/contracts-contributions.ts',
  'apps/api/src/features/ext/manifest-validate.ts',
  'apps/api/src/features/ext/fs-discovery.ts',
  'apps/api/src/lib/edit-distance.ts',
  'apps/api/src/lib/path-containment.ts',
  'packages/path-containment/dist',
  'apps/api/src/contracts/route-body-rule.ts',
  'apps/api/src/contracts/ui-token-rules.ts',
  'apps/api/src/contracts/ui-token-existence.ts',
]

/** Bundle the facade into one self-contained module at `<outKit>/tools/authoring.mjs`. */
export async function buildKitTools(repoRoot, outKit) {
  const result = await Bun.build({
    entrypoints: [join(repoRoot, KIT_TOOLS_ENTRY)],
    outdir: join(outKit, 'tools'),
    target: 'bun',
    format: 'esm',
    naming: { entry: 'authoring.mjs' },
  })
  if (!result.success) throw new Error(result.logs.map(String).join('\n'))
  return KIT_TOOLS_FILE
}

/** The release this kit belongs to: the stamped desktop version, or `LOCALIX_VERSION`. */
export function localixVersion(repoRoot) {
  if (process.env.LOCALIX_VERSION?.trim()) return process.env.LOCALIX_VERSION.trim()
  const conf = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop-tauri/src-tauri/tauri.conf.json'), 'utf8'),
  )
  return typeof conf.version === 'string' ? conf.version : 'unknown'
}

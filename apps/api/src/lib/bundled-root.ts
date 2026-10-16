import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * SELF-LOCATION of a bundled asset root: resolve
 * shipped assets from the running module's own URL, never a hand-passed path).
 *
 * The same three-step rule is shared by the bundled `plugins/` root and the
 * `migrations/` folder. It has one owner here.
 *
 * The caller passes its OWN `import.meta.url`: self-location only works when it is
 * evaluated in the module that knows its position relative to the asset, and the
 * bundler rewrites that URL to the OUTPUT location — which is exactly the property
 * the rule depends on:
 *
 *   1. `override` (an env escape hatch) — wins when set.
 *   2. a `<dirName>/` SIBLING of the calling module — the BUNDLED layout, staged by
 *      the build beside the server bundle (CLI `server/` + desktop `resources/`).
 *   3. else `sourceRelative` from the calling module's dir — running from source.
 *
 * `existsSync` runs per call (as before), so a root staged after boot is still seen.
 */
export function resolveBundledRoot(opts: {
  /** `import.meta.url` of the CALLING module. */
  moduleUrl: string
  /** The staged sibling directory's name in the bundled layout, e.g. `plugins`. */
  dirName: string
  /** Path from the calling module's dir to the asset root in the SOURCE tree. */
  sourceRelative: string
  /** Explicit override (env escape hatch, tests inject a fixture root); wins when set. */
  override?: string | undefined
}): string {
  if (opts.override) return opts.override
  const moduleDir = dirname(fileURLToPath(opts.moduleUrl))
  const bundledSibling = join(moduleDir, opts.dirName)
  if (existsSync(bundledSibling)) return bundledSibling
  return join(moduleDir, opts.sourceRelative)
}

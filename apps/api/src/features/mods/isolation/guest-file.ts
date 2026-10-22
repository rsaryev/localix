import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The runtime a mod instance's VM runs (`guest/main.ts`), bundled into one script for QuickJS: a
 * BUNDLED host carries it beside its entry bundle, where the desktop build writes it
 * (`apps/desktop-tauri/scripts/prepare-sidecar.mjs`); from source it is built on first use. Imports
 * nothing of the feature, so a build script can read the name and build it.
 */
export const MOD_RUNTIME_FILE = 'mod-runtime.js'

/** The runtime as one script: no imports, no `require`, nothing of Bun or Node. */
export async function buildModRuntime(): Promise<string> {
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./guest/main.ts', import.meta.url))],
    target: 'browser',
    format: 'iife',
    // Identifiers stay, so a stack trace from inside the VM names the runtime's own functions.
    minify: { syntax: true, whitespace: true, identifiers: false },
    throw: false,
  })
  if (!build.success)
    throw new Error(
      `the mods runtime did not build: ${build.logs.map((log) => log.message).join('\n')}`,
    )
  return build.outputs[0]!.text()
}

let fromSource: Promise<string> | undefined

/** The bundled runtime beside `dir` when there is one, else this source tree's, built once. */
export function loadModRuntime(dir?: string): Promise<string> {
  const bundled = dir === undefined ? undefined : join(dir, MOD_RUNTIME_FILE)
  if (bundled && existsSync(bundled)) return readFile(bundled, 'utf8')
  if (!fromSource) {
    const building = buildModRuntime()
    building.catch(() => (fromSource = undefined))
    fromSource = building
  }
  return fromSource
}

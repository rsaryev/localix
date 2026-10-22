import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { isPathBelow } from '../../lib/path-containment'
import type { BunPlugin } from 'bun'
import { CLAUDE_CODE_RUNTIME, ModBuildError } from './module-build'

/**
 * A `Client`'s surface module, as the desktop runs it: read off the hooks module's source at load
 * (`client-source.ts`), then bundled on its own for the browser — its JSX against the frame's `h`
 * and `Fragment`, importing only its plugin's files and `claude-code` — and served to the screen,
 * which runs it in an isolated frame with no reach into the app (`ModClient` in the UI).
 */

/** A bundled surface module past this is refused: it is drawing code, not a payload. */
const MAX_CLIENT_BUNDLE = 4 * 1024 * 1024
/** Where the bundle leaves the module's exports for the frame (`clientFrameRuntime.ts`). */
const CLIENT_EXPORTS = "Symbol.for('localix.mods.client')"

/** Strictly inside the plugin: the plugin's own folder is no module. */
const inside = (root: string, path: string) => isPathBelow(root, path)

/** The surface module at `module` (its path under `root`) as one script for the frame. */
export async function bundleClientModule(root: string, module: string): Promise<string> {
  const entry = join(root, ...module.split('/'))
  const realRoot = realpathSync(root)
  const plugin: BunPlugin = {
    name: 'localix-client',
    setup(builder) {
      builder.onResolve({ filter: /^localix-client:entry$/ }, (args) => ({
        path: args.path,
        namespace: 'localix-client',
      }))
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === 'claude-code') return { path: 'claude-code', namespace: 'claude-code' }
        if (args.path.startsWith('.') || args.path.startsWith('/')) return undefined
        throw new ModBuildError(
          `${args.path}: a surface module imports only its plugin's files and claude-code`,
        )
      })
      builder.onLoad({ filter: /.*/, namespace: 'localix-client' }, () => ({
        contents: `import * as surface from ${JSON.stringify(entry)}\nglobalThis[${CLIENT_EXPORTS}] = surface\n`,
        loader: 'js',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'claude-code' }, () => ({
        contents: CLAUDE_CODE_RUNTIME,
        loader: 'js',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        if (!inside(realRoot, realpathSync(args.path)))
          throw new ModBuildError(`${args.path}: a surface module reaches outside its plugin`)
        return undefined
      })
    },
  }
  const build = await Bun.build({
    throw: false,
    entrypoints: ['localix-client:entry'],
    target: 'browser',
    format: 'iife',
    jsx: { runtime: 'classic', factory: 'h', fragment: 'Fragment' },
    plugins: [plugin],
  })
  if (!build.success)
    throw new ModBuildError(build.logs.map((log) => log.message).join('\n') || 'build failed')
  const output = build.outputs.find((file) => file.kind === 'entry-point') ?? build.outputs[0]
  const code = await output!.text()
  if (code.length > MAX_CLIENT_BUNDLE) throw new ModBuildError(`${module} bundles too large`)
  return code
}

/** A surface module as the screen gets it: its code, or why it did not build. */
export type ClientBundle = { revision: string } & ({ code: string } | { problem: string })

/** Every surface module a hooks module named, bundled; one that fails says why when drawn. */
export async function bundleClientModules(
  root: string,
  modules: ReadonlySet<string>,
): Promise<Map<string, ClientBundle>> {
  const bundles = new Map<string, ClientBundle>()
  for (const module of modules) {
    const result = await bundleClientModule(root, module).then(
      (code) => ({ code }),
      (error: unknown) => ({ problem: error instanceof Error ? error.message : String(error) }),
    )
    const body = 'code' in result ? result.code : result.problem
    const revision = createHash('sha256').update(body).digest('hex').slice(0, 16)
    bundles.set(module, { revision, ...result })
  }
  return bundles
}

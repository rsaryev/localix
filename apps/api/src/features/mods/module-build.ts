import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Fragment, h, type RegisterFunction } from '@localixai/claude-plugin/mods'

/**
 * A hooks module as Claude Code loads it: an ES module (`.js` … `.tsx`) importing only files of its
 * own plugin and `claude-code`, its JSX compiled against the globals `h` and `Fragment`. It is
 * bundled into one file under the mod's data directory — which resolves its relative imports,
 * applies that JSX factory and gives `claude-code` its runtime half — and imported from there. The
 * file is named by its content, so a reload after an edit imports the new one.
 */

/** Where the host hands bundled modules the runtime half of `claude-code`. */
const RUNTIME = Symbol.for('localix.mods.claude-code')
;(globalThis as Record<symbol, unknown>)[RUNTIME] = { h, Fragment }

/** What `import … from 'claude-code'` gives a hooks module at run time. */
const CLAUDE_CODE_RUNTIME = `
const runtime = globalThis[Symbol.for('localix.mods.claude-code')]
export const h = runtime.h
export const Fragment = runtime.Fragment
const missing = (name) => () => {
  throw new Error(name + ' from claude-code is not available in Localix yet')
}
export const atom = missing('atom')
export const read = missing('read')
export const update = missing('update')
export const derive = missing('derive')
export const memberOf = missing('memberOf')
`

const JSX_IMPORT = "import { h as __modsH, Fragment as __modsFragment } from 'claude-code';"

/** A specifier a module may import besides its own files. */
const ALLOWED_BARE = new Set(['claude-code'])

export class ModBuildError extends Error {}

export async function buildHooksModule(input: {
  module: string
  root: string
  outDir: string
}): Promise<RegisterFunction> {
  const build = await Bun.build({
    entrypoints: [input.module],
    target: 'bun',
    format: 'esm',
    jsx: { runtime: 'classic', factory: '__modsH', fragment: '__modsFragment' },
    plugins: [
      {
        name: 'claude-code',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === 'claude-code')
              return { path: 'claude-code', namespace: 'claude-code' }
            const relative = args.path.startsWith('.') || args.path.startsWith('/')
            if (!relative && !ALLOWED_BARE.has(args.path) && args.importer)
              throw new ModBuildError(
                `${args.path}: a hooks module imports only its plugin's files and claude-code`,
              )
            return undefined
          })
          // JSX compiles against `h` and `Fragment`, which a hooks module never imports.
          builder.onLoad({ filter: /\.[jt]sx$/ }, async (args) => ({
            // On the first line, so the module's line numbers stay its own.
            contents: `${JSX_IMPORT}${await Bun.file(args.path).text()}`,
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'claude-code' }, () => ({
            contents: CLAUDE_CODE_RUNTIME,
            loader: 'js',
          }))
        },
      },
    ],
  })
  if (!build.success)
    throw new ModBuildError(build.logs.map((log) => String(log)).join('\n') || 'build failed')
  const code = await build.outputs[0]!.text()
  const file = join(
    input.outDir,
    `hooks-${createHash('sha256').update(code).digest('hex').slice(0, 16)}.mjs`,
  )
  await fs.mkdir(input.outDir, { recursive: true })
  await fs.writeFile(file, code)
  const loaded = (await import(pathToFileURL(file).href)) as { register?: unknown }
  if (typeof loaded.register !== 'function')
    throw new ModBuildError('The hooks module does not export a register function')
  return loaded.register as RegisterFunction
}

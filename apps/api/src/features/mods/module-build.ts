import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Fragment, h, type RegisterFunction } from '@localixai/claude-plugin/mods'
import { readClientModules } from './client-source'
import { STATE_LIBRARY } from './state-library'

/**
 * A hooks module as Claude Code loads it: an ES module (`.js` … `.tsx`) importing only files of its
 * own plugin and `claude-code`, its JSX compiled against the globals `h` and `Fragment` (or what a
 * file's `@jsx` pragma names). It is bundled into one file under the mod's data directory — which
 * resolves its relative imports and gives `claude-code` its runtime half — and imported from
 * there. The bundle is built once; each instance of the mod imports its own copy, named by the
 * content and the instance, so instances keep their own module state and an edit imports anew.
 */

/** Where the host hands bundled modules the runtime half of `claude-code`. */
const RUNTIME = Symbol.for('localix.mods.claude-code')
;(globalThis as Record<symbol, unknown>)[RUNTIME] = { h, Fragment }

/** What `import … from 'claude-code'` gives a hooks module (or a surface module) at run time. */
export const CLAUDE_CODE_RUNTIME = `
const runtime = globalThis[Symbol.for('localix.mods.claude-code')]
export const h = runtime.h
export const Fragment = runtime.Fragment
${STATE_LIBRARY}`

/** The globals a hooks module may use unbound, as in Claude Code. */
const GLOBALS = ['h', 'Fragment'] as const

/**
 * Binds the globals the bundle uses unbound. The bundler renames every top-level declaration of a
 * name some module uses unbound, so a bundle declaring one at the top uses none unbound.
 */
function preludeOf(code: string): string {
  return GLOBALS.filter(
    (name) =>
      !new RegExp(`^(?:var|let|const|(?:async )?function\\*?|class) ${name}\\b`, 'm').test(code),
  )
    .map((name) => `var ${name} = globalThis[Symbol.for('localix.mods.claude-code')].${name};\n`)
    .join('')
}

/** A specifier a module may import besides its own files. */
const ALLOWED_BARE = new Set(['claude-code'])

export class ModBuildError extends Error {}

/**
 * The hooks module as one ES module's source. Each `Client` it constructs names its surface module
 * as a literal, read here and rewritten to its path under the plugin (into `options.clients`).
 */
export async function bundleHooksModule(
  input: { module: string; root: string },
  options: { clients?: Set<string> } = {},
): Promise<string> {
  const build = await Bun.build({
    // The build's own messages name the file and line; a thrown `Bundle failed` names neither.
    throw: false,
    entrypoints: [input.module],
    target: 'bun',
    format: 'esm',
    jsx: { runtime: 'classic', factory: 'h', fragment: 'Fragment' },
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
          builder.onLoad({ filter: /.*/, namespace: 'claude-code' }, () => ({
            contents: CLAUDE_CODE_RUNTIME,
            loader: 'js',
          }))
          builder.onLoad({ filter: /\.(?:[cm]?js|jsx|tsx?)$/, namespace: 'file' }, async (args) => {
            const loader = args.loader
            if (loader !== 'js' && loader !== 'jsx' && loader !== 'ts' && loader !== 'tsx') return
            const source = await fs.readFile(args.path, 'utf8')
            const contents = readClientModules({
              source,
              file: args.path,
              root: input.root,
              loader,
              found: options.clients,
            })
            return contents === undefined ? undefined : { contents, loader: 'js' }
          })
        },
      },
    ],
  })
  if (!build.success)
    throw new ModBuildError(build.logs.map((log) => log.message).join('\n') || 'build failed')
  const bundled = await build.outputs[0]!.text()
  return preludeOf(bundled) + bundled
}

/**
 * One load of a bundled module: a copy in a directory no earlier load used, imported. The runtime
 * keeps a module by its path, and its resolver caches a directory's listing once it has read it,
 * so a new file in a known directory would not be found. The copy stays while the process runs —
 * a watching dev server restarts when a file it imported goes — and `clearHooksCopies` removes
 * what earlier processes left.
 */
export async function importHooksModule(
  code: string,
  outDir: string,
  load: string,
): Promise<RegisterFunction> {
  const digest = createHash('sha256').update(code).digest('hex').slice(0, 16)
  const dir = join(outDir, `load-${createHash('sha256').update(load).digest('hex').slice(0, 16)}`)
  const file = join(dir, `hooks-${digest}.mjs`)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, code)
  const loaded = (await import(pathToFileURL(file).href)) as { register?: unknown }
  if (typeof loaded.register !== 'function')
    throw new ModBuildError('The hooks module does not export a register function')
  return loaded.register as RegisterFunction
}

/** Removes the copies an earlier process imported; call before this process imports any. */
export async function clearHooksCopies(outDir: string): Promise<void> {
  const names = await fs.readdir(outDir).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => name.startsWith('load-') || /^hooks-.*\.mjs$/.test(name))
      .map((name) => fs.rm(join(outDir, name), { recursive: true, force: true })),
  )
}

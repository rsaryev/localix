import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readClientModules } from './client-source'
import { compileHooksBundle } from './isolation/lockdown'
import { STATE_LIBRARY } from './state-library'

/**
 * A hooks module as Claude Code loads it: an ES module (`.js` … `.tsx`) importing only files of its
 * own plugin and `claude-code`, its JSX compiled against the globals `h` and `Fragment` (or what a
 * file's `@jsx` pragma names). It is bundled into one CommonJS file — which resolves its relative
 * imports and gives `claude-code` its runtime half — and each instance of the mod runs its own copy
 * in a worker of its own (`isolation/`), so instances keep their own module state and an edit
 * loads anew. The bundle is built once and handed to each load's worker as text: nothing a mod
 * could write (`$.fs.write`) is ever read back as code.
 */

/** What `import … from 'claude-code'` gives a hooks module (or a surface module) at run time. */
export const CLAUDE_CODE_RUNTIME = `
const runtime = globalThis[Symbol.for('localix.mods.claude-code')]
export const h = runtime.h
export const Fragment = runtime.Fragment
${STATE_LIBRARY}`

/**
 * What a module may not do at run time, though it builds: import (`import(x)` of a name the build
 * cannot see), or read `import.meta`, Bun's door to `require`. A string, comment or regular
 * expression that only spells either is no import, so the bundle is read as JavaScript reads it:
 * Bun's scanner names each `import("literal")`, but not `import(name)`, so the engine decides the
 * rest. Every `import` the text spells where the keyword could stand becomes characters no code may
 * hold but a string, comment or regular expression may; when the text still compiles as the worker
 * compiles it (a function body), none of them was code. `import.meta` does not compile there.
 */
const RUNTIME_IMPORT_REFUSED =
  'a hooks module imports nothing at run time (import(…), import.meta); it reaches files, ' +
  'processes and the network through $'

/** `import` where the keyword could stand: not part of a name, a member (`x.import`) or a key. */
const IMPORT_WORD =
  /(?<![\p{ID_Continue}$\\])(?<!(?:^|[^.])\.)import(?![\p{ID_Continue}$])(?!\s*:)/gu

/** Why `bundled` cannot run as the worker runs it, or undefined when it can. */
function runtimeProblem(bundled: string): string | undefined {
  const { imports } = new Bun.Transpiler({ loader: 'js' }).scan(bundled)
  if (imports.some((one) => one.kind === 'dynamic-import')) return RUNTIME_IMPORT_REFUSED
  try {
    compileHooksBundle(bundled, 'hooks.cjs')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /import\.meta/.test(message)
      ? RUNTIME_IMPORT_REFUSED
      : `the bundle does not compile: ${message}`
  }
  try {
    compileHooksBundle(bundled.replace(IMPORT_WORD, '@@@@@@'), 'hooks.cjs')
  } catch {
    return RUNTIME_IMPORT_REFUSED
  }
  return undefined
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
    // Plain CommonJS statements the worker compiles as a function body: no `import.meta` or
    // `require('node:module')` of a Bun or Node runtime helper.
    target: 'browser',
    format: 'cjs',
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
  const problem = runtimeProblem(bundled)
  if (problem) throw new ModBuildError(problem)
  return bundled
}

/** Removes the copies of a module earlier versions of Localix wrote to disk for each load. */
export async function clearHooksCopies(outDir: string): Promise<void> {
  const names = await fs.readdir(outDir).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => name.startsWith('load-') || /^hooks-.*\.(?:mjs|cjs)$/.test(name))
      .map((name) => fs.rm(join(outDir, name), { recursive: true, force: true })),
  )
}

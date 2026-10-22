import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readClientModules } from './client-source'
import { STATE_LIBRARY } from './state-library'

/**
 * A hooks module as Claude Code loads it: an ES module (`.js` … `.tsx`) importing only files of its
 * own plugin and `claude-code`, its JSX compiled against the globals `h` and `Fragment` (or what a
 * file's `@jsx` pragma names). It is bundled into one CommonJS file — which resolves its relative
 * imports and gives `claude-code` its runtime half — and each instance of the mod runs its own copy
 * in a VM of its own (`isolation/`), so instances keep their own module state and an edit loads
 * anew. The bundle is built once and handed to each load's VM as text: nothing a mod could write
 * (`$.fs.write`) is ever read back as code. The VM evaluates it as a function body, where
 * `import.meta` does not compile and `import(…)` has nothing to load, so the module imports
 * nothing at run time.
 */

/** What `import … from 'claude-code'` gives a hooks module (or a surface module) at run time. */
export const CLAUDE_CODE_RUNTIME = `
const runtime = globalThis[Symbol.for('localix.mods.claude-code')]
export const h = runtime.h
export const Fragment = runtime.Fragment
${STATE_LIBRARY}`

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
    // Plain CommonJS statements the VM evaluates as a function body: no `import.meta` or
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
  return build.outputs[0]!.text()
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

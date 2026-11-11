import { promises as fs } from 'node:fs'
import { readClientModules } from './client-source'
import type { ModCompiler } from '@rsaryev/llx-plugin/mods'
import type { PluginFiles } from '@rsaryev/llx-plugin'
import { STATE_LIBRARY_SOURCE, type DiskFiles } from '../plugins/kit'
import { errorMessage } from '../../lib/errors'
import { VM_FORMAT } from './isolation/vm-runtime'

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
${STATE_LIBRARY_SOURCE}`

/** A specifier a module may import besides its own files. */
const ALLOWED_BARE = new Set(['claude-code'])

export class ModBuildError extends Error {}

/**
 * The hooks module as one ES module's source. Each `Client` it constructs names its surface module
 * as a literal, read here and rewritten to its path under the plugin (into `options.clients`).
 */
export async function bundleHooksModule(
  input: { module: string; root: string },
  options: { clients?: Set<string>; format?: 'cjs' | 'esm' } = {},
): Promise<string> {
  const build = await Bun.build({
    // The build's own messages name the file and line; a thrown `Bundle failed` names neither.
    throw: false,
    entrypoints: [input.module],
    // Plain CommonJS statements the VM evaluates as a function body: no `import.meta` or
    // `require('node:module')` of a Bun or Node runtime helper.
    target: 'browser',
    format: options.format ?? 'cjs',
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

const SCAN_LOADERS = { '.ts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.mts': 'ts' } as const

/** The entry as the scan reads it: one ES module, as written but for its types and JSX. */
async function scanSource(module: string): Promise<string> {
  const source = await fs.readFile(module, 'utf8')
  const extension = module.slice(module.lastIndexOf('.')) as keyof typeof SCAN_LOADERS
  const loader = SCAN_LOADERS[extension] ?? 'js'
  const transpiler = new Bun.Transpiler({
    loader,
    tsconfig: {
      compilerOptions: { jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' },
    },
  })
  return transpiler.transformSync(source)
}

const isDiskFiles = (files: PluginFiles): files is DiskFiles =>
  typeof (files as Partial<DiskFiles>).hostPath === 'function'

export interface ModuleCompilerOptions {
  /**
   * The revision of the plugin at `root` (`ModSource.revision`): a module is built once per
   * revision however many conversations load it. Without one it is built at every load.
   */
  revisionOf?: (root: string) => string | undefined
  /** The surface modules a build read off the hooks module's source (`client-source.ts`). */
  clients?: (root: string, modules: ReadonlySet<string>) => void
}

type Compiled = Awaited<ReturnType<ModCompiler['compile']>>

/**
 * The kit's `ModCompiler`: the entry module as the ES module the kit's scan reads (its TypeScript
 * and JSX compiled away, its imports and exports as written), and the module bundled from the
 * plugin's folder on the disk as the CommonJS the VM runs (`isolation/vm-runtime.ts`).
 * A build that fails is the module's issue, naming the file and why.
 */
export function createModuleCompiler(options: ModuleCompilerOptions = {}): ModCompiler {
  const built = new Map<string, Promise<Compiled>>()
  async function compile(files: DiskFiles, entry: string): Promise<Compiled> {
    const input = { module: files.hostPath(entry), root: files.root }
    const clients = new Set<string>()
    try {
      const [scan, run] = await Promise.all([
        scanSource(input.module),
        bundleHooksModule(input, { clients }),
      ])
      options.clients?.(files.root, clients)
      return { scan: { code: scan }, run: { code: run, format: VM_FORMAT }, issues: [] }
    } catch (error) {
      return { issues: [{ severity: 'error', path: entry, message: errorMessage(error) }] }
    }
  }
  return {
    compile({ files, entry }) {
      if (!isDiskFiles(files))
        return Promise.resolve({
          issues: [{ severity: 'error', path: entry, message: `${entry}: not on the disk` }],
        })
      const revision = options.revisionOf?.(files.root)
      if (revision === undefined) return compile(files, entry)
      const key = `${files.root}\u0000${entry}`
      const kept = built.get(`${key}\u0000${revision}`)
      if (kept) return kept
      // A new revision of the module: the old build goes.
      for (const old of Array.from(built.keys()))
        if (old.startsWith(`${key}\u0000`)) built.delete(old)
      const next = compile(files, entry)
      built.set(`${key}\u0000${revision}`, next)
      return next
    },
  }
}

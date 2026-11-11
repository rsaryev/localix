import { realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { isPathBelow } from '../../lib/path-containment'
import { scanHooksModule } from '../plugins/kit/mods'

/**
 * Reading a `Client`'s surface module off a hooks module's source, before anything runs, as the
 * kit's scan reads it (`scanHooksModule`'s `surfaceModuleSpans`): each `Client({ module })` — JSX
 * compiles to `h(Client, { module })` — names its module as a string literal relative to its file,
 * inside the plugin. Each literal is rewritten to the module's path under the plugin, which is what
 * the drawing then carries; a `Client` whose module was not read here is refused when it is drawn.
 */

const JSX_CONFIG = {
  compilerOptions: { jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' },
} as const

/** A `Client` whose module cannot be read off the source: the hooks module does not load. */
export class ClientModuleError extends Error {}

function isFileInside(root: string, path: string): boolean {
  try {
    // Strictly inside the plugin: the plugin's own folder is no module.
    return statSync(path).isFile() && isPathBelow(root, realpathSync(path))
  } catch {
    return false
  }
}

/**
 * One file of a hooks module with each `Client`'s module rewritten to its path under the plugin
 * (and added to `found`); undefined for a file that constructs no `Client`, which loads as it is.
 */
export function readClientModules(input: {
  source: string
  file: string
  root: string
  loader: 'js' | 'jsx' | 'ts' | 'tsx'
  found?: Set<string>
}): string | undefined {
  if (!/\bClient\b/.test(input.source)) return undefined
  const transpiler = new Bun.Transpiler({ loader: input.loader, tsconfig: JSX_CONFIG })
  const code = transpiler.transformSync(input.source)
  // Paths compared as the disk has them: a plugin reached through a symlink is still inside.
  const root = realpathSync(input.root)
  const name = relative(root, realpathSync(input.file)).split(sep).join('/')
  const scan = scanHooksModule(code, name)
  // A `Client` refusal is the kit's `client-props` or `client-module`; the file's other rules its
  // load checks.
  const refusal = scan.issues.find(
    (issue) => issue.code === 'client-props' || issue.code === 'client-module',
  )
  if (refusal) throw new ClientModuleError(refusal.message)
  if (scan.surfaceModuleSpans.length === 0) return undefined
  let rewritten = code
  for (const span of [...scan.surfaceModuleSpans].reverse()) {
    if (!isFileInside(root, resolve(root, span.module)))
      throw new ClientModuleError(
        `${name}: Client module "${span.module}" names no file inside the plugin`,
      )
    input.found?.add(span.module)
    rewritten =
      rewritten.slice(0, span.start) + JSON.stringify(span.module) + rewritten.slice(span.end)
  }
  return rewritten
}

/**
 * A `node:` import reachable from the web entry FAILS THE BUILD, at the import, naming the
 * importer.
 *
 * Vite's own answer to a node builtin in browser code is to externalize it: the module resolves
 * to a stub, the build succeeds, the dev server serves the page, and the first component that
 * touches the stub throws `Module "node:dns" has been externalized for browser compatibility` —
 * from inside React's commit phase, with a stack that names every React internal and no
 * importer. The cause is never in the UI: it is one VALUE edge into server code and every module
 * that server module imports. The last one was `ApiError` inside the shared agent-policy leaf,
 * which dragged the plugin SDK's backend barrel (`node:dns`, `node:net`, `node:fs/promises`) in
 * behind the settings screen.
 *
 * `scripts/browser-graph-guard.test.ts` finds that chain, but only when someone runs it; the
 * person opening the page finds the stub. So the leak is also refused where it ENTERS the graph,
 * and the message carries the one fact the runtime error withholds — which file imported it.
 *
 * Its own module, not a closure in `vite.config.ts`, so it can be tested: a guard needs a case
 * proving it fails when it should (`fail-on-node-builtin.test.ts`), and a plugin buried in a
 * config is a guard nobody can call.
 */
import { builtinModules } from 'node:module'
import type { Plugin } from 'vite'

/**
 * The builtins `vite-plugin-node-polyfills` serves to the browser on purpose. This plugin runs
 * at `enforce: 'pre'`, ahead of it, so the three it handles have to be named here or the
 * polyfilled imports would be refused before it ever sees them.
 */
const POLYFILLED = new Set(['events', 'process', 'buffer'])

/**
 * A Set, built once, and the cheap test FIRST.
 *
 * `resolveId` runs for every import in the graph — tens of thousands of calls in one build —
 * and the obvious spelling of this check, `builtinModules.includes(id)`, is a linear scan of
 * ~80 names on each of them. Measured on a full UI build, that alone made this plugin 95% of
 * the time spent in plugins. Relative and aliased specifiers are almost all of the traffic and
 * cannot be builtins, so they leave on the first character.
 */
const BUILTIN_NAMES = new Set(builtinModules)

const isBuiltin = (id: string): boolean =>
  id.startsWith('node:') || (!id.startsWith('.') && !id.startsWith('/') && BUILTIN_NAMES.has(id))

/** Whether this import, from this importer, is a leak of server code into the browser bundle. */
export function isBrowserLeak(id: string, importer: string | undefined): boolean {
  if (!importer || !isBuiltin(id)) return false
  if (POLYFILLED.has(id.startsWith('node:') ? id.slice(5) : id)) return false
  // Third-party packages are the polyfill plugin's business: their builtins are shimmed or
  // shaken out, and this repository cannot fix them by failing on them.
  return !importer.includes('/node_modules/')
}

export function browserLeakMessage(id: string, importer: string): string {
  return (
    `"${id}" is a Node builtin and cannot run in the browser. It is imported by\n  ${importer}\n` +
    'which the web entry can reach — usually through a shared leaf that VALUE-imports server ' +
    'code. Put the browser-safe rule in its own leaf (a subpath in apps/api/package.json exports) ' +
    'and leave the throwing/IO half on the server. `bun test scripts/browser-graph-guard.test.ts` ' +
    'prints the whole chain.'
  )
}

export function failOnNodeBuiltin(): Plugin {
  return {
    name: 'localix:fail-on-node-builtin',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!isBrowserLeak(id, importer)) return null
      throw new Error(browserLeakMessage(id, importer!))
    },
  }
}

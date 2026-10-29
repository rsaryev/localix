// Bundler plugins the kit runtime is built with (`stage-mini-app-kit-runtime.mjs`).

/**
 * Vite's import queries (`?worker`, `?url`, `?raw`) in host code a test never runs (Monaco's
 * workers, the PDF worker): a test runtime needs the module graph to resolve, not the asset.
 */
export const viteQueries = {
  name: 'vite-queries',
  setup(build) {
    build.onResolve({ filter: /\?(?:worker|url|raw|inline)$/u }, (args) => ({
      path: args.path,
      namespace: 'vite-query',
    }))
    build.onLoad({ filter: /.*/u, namespace: 'vite-query' }, (args) => ({
      loader: 'js',
      contents: args.path.endsWith('?worker')
        ? 'export default class ViteWorkerStub {}\n'
        : `export default ${JSON.stringify(args.path)}\n`,
    }))
  },
}

/**
 * React's `act` waits on Node's `setImmediate`, which it finds through `module.require` — absent
 * from a bundled CommonJS module, so it fell back to a MessageChannel that delivers BEFORE a frame
 * the render scheduled: a toolbar placed in `requestAnimationFrame` never showed inside `act`.
 * The bundle asks for the timers module directly; staging fails if React stops looking it up so.
 */
const REACT_TIMERS = /\(module && module\[requireString\]\)\.call\(\s*module,\s*"timers"\s*\)/u
export const reactTimers = {
  name: 'react-timers',
  setup(build) {
    build.onLoad({ filter: /[\\/]react[\\/]cjs[\\/]react\.development\.js$/u }, async (args) => {
      const source = await Bun.file(args.path).text()
      if (!REACT_TIMERS.test(source))
        throw new Error(`React no longer looks up timers: ${args.path}`)
      return { loader: 'js', contents: source.replace(REACT_TIMERS, 'require("node:timers")') }
    })
  },
}

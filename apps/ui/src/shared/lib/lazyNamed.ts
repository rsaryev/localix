import { lazy, type LazyExoticComponent } from 'react'

/** Any component `lazy` accepts, whatever its props. */
type Lazyable = Awaited<ReturnType<Parameters<typeof lazy>[0]>>['default']

/**
 * `React.lazy` for a module's named export: `lazyNamed(() => import('./Panel'), 'Panel')`. The
 * caller keeps the literal `import()`, so the bundler still splits that module into its own chunk.
 */
export function lazyNamed<M extends Record<K, Lazyable>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => load().then((module) => ({ default: module[name] })))
}

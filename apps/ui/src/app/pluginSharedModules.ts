import {
  PLUGIN_UI_KIT_PREFIX,
  PLUGIN_UI_PRELOADED_MODULES,
  PLUGIN_UI_SHARED_GLOBAL,
  isPluginUiSharedModule,
  type PluginUiSharedModules,
} from '@localixai/plugin-sdk/ui-artifact'

/**
 * The host's side of the shared-module contract: the ONE instance of React, of the plugin SDK
 * and of the host UI kit that every plugin artifact runs against.
 *
 * A plugin artifact bundles everything else itself. These cannot be bundled twice: a second React
 * breaks hooks, a second SDK has unbound transport and empty command maps, a second kit component
 * reads contexts the host never provided. So the artifact's build turns each import of one of
 * them into `await host.load(specifier)`, and this registry answers with the module the host
 * itself uses — loaded on first request, so a kit module (Monaco behind the code editor) costs
 * nothing until a plugin chunk that needs it is opened.
 *
 * Every entry is a literal `import()`, which is what lets the bundler give the host and the
 * plugins the same module instance.
 */
type Loader = () => Promise<Record<string, unknown>>

const CORE: Record<string, Loader> = {
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react/jsx-dev-runtime': () => import('react/jsx-dev-runtime'),
  'react-dom': () => import('react-dom'),
  'react-dom/client': () => import('react-dom/client'),
}

/** Every browser-side SDK entry (`pluginSharedModules.test.ts` pins this to the package exports). */
export const SDK_SHARED_MODULES: Record<string, Loader> = {
  '@localixai/plugin-sdk/ui': () => import('@localixai/plugin-sdk/ui'),
  '@localixai/plugin-sdk/ui/chart-export': () => import('@localixai/plugin-sdk/ui/chart-export'),
  '@localixai/plugin-sdk/ui/charts': () => import('@localixai/plugin-sdk/ui/charts'),
  '@localixai/plugin-sdk/ui/classes': () => import('@localixai/plugin-sdk/ui/classes'),
  '@localixai/plugin-sdk/ui/commands': () => import('@localixai/plugin-sdk/ui/commands'),
  '@localixai/plugin-sdk/ui/comments': () => import('@localixai/plugin-sdk/ui/comments'),
  '@localixai/plugin-sdk/ui/components': () => import('@localixai/plugin-sdk/ui/components'),
  '@localixai/plugin-sdk/ui/file-types': () => import('@localixai/plugin-sdk/ui/file-types'),
  '@localixai/plugin-sdk/ui/focus': () => import('@localixai/plugin-sdk/ui/focus'),
  '@localixai/plugin-sdk/ui/interactions': () => import('@localixai/plugin-sdk/ui/interactions'),
  '@localixai/plugin-sdk/ui/message-binding-drag': () =>
    import('@localixai/plugin-sdk/ui/message-binding-drag'),
  '@localixai/plugin-sdk/ui/path-tree': () => import('@localixai/plugin-sdk/ui/path-tree'),
  '@localixai/plugin-sdk/ui/problems': () => import('@localixai/plugin-sdk/ui/problems'),
  '@localixai/plugin-sdk/ui/store-resource': () =>
    import('@localixai/plugin-sdk/ui/store-resource'),
  '@localixai/plugin-sdk/ui/route-snapshot': () =>
    import('@localixai/plugin-sdk/ui/route-snapshot'),
  '@localixai/plugin-sdk/ui/store-snapshot': () =>
    import('@localixai/plugin-sdk/ui/store-snapshot'),
  '@localixai/plugin-sdk/ui/resource-sync': () => import('@localixai/plugin-sdk/ui/resource-sync'),
  '@localixai/plugin-sdk/ui/file-resource-sync': () =>
    import('@localixai/plugin-sdk/ui/file-resource-sync'),
  '@localixai/plugin-sdk/ui/realtime-feed': () => import('@localixai/plugin-sdk/ui/realtime-feed'),
  '@localixai/plugin-sdk/ui/resource-topics': () =>
    import('@localixai/plugin-sdk/ui/resource-topics'),
  '@localixai/plugin-sdk/ui/result-count-status': () =>
    import('@localixai/plugin-sdk/ui/result-count-status'),
  '@localixai/plugin-sdk/ui/runtime': () => import('@localixai/plugin-sdk/ui/runtime'),
  '@localixai/plugin-sdk/ui/runtime-hooks': () => import('@localixai/plugin-sdk/ui/runtime-hooks'),
  '@localixai/plugin-sdk/ui/segmented-control': () =>
    import('@localixai/plugin-sdk/ui/segmented-control'),
  '@localixai/plugin-sdk/ui/session-activity': () =>
    import('@localixai/plugin-sdk/ui/session-activity'),
  '@localixai/plugin-sdk/ui/session-tree': () => import('@localixai/plugin-sdk/ui/session-tree'),
  '@localixai/plugin-sdk/ui/shared-resource': () =>
    import('@localixai/plugin-sdk/ui/shared-resource'),
  '@localixai/plugin-sdk/ui/stats-charts': () => import('@localixai/plugin-sdk/ui/stats-charts'),
  '@localixai/plugin-sdk/ui/storage': () => import('@localixai/plugin-sdk/ui/storage'),
  '@localixai/plugin-sdk/ui/table': () => import('@localixai/plugin-sdk/ui/table'),
  '@localixai/plugin-sdk/ui/transport': () => import('@localixai/plugin-sdk/ui/transport'),
  '@localixai/plugin-sdk/ui/use-problem-report': () =>
    import('@localixai/plugin-sdk/ui/use-problem-report'),
  '@localixai/plugin-sdk/ui/utilities': () => import('@localixai/plugin-sdk/ui/utilities'),
  '@localixai/plugin-sdk/ui/visibility': () => import('@localixai/plugin-sdk/ui/visibility'),
  // The host's own instance: its provider and a plugin's `useWorkItemSessionId` must share one
  // React context, or every plugin tab would read no session at all.
  '@localixai/plugin-sdk/ui/work-item-session': () =>
    import('@localixai/plugin-sdk/ui/work-item-session'),
  '@localixai/plugin-sdk/rich-text': () => import('@localixai/plugin-sdk/rich-text'),
  '@localixai/plugin-sdk/store-changes': () => import('@localixai/plugin-sdk/store-changes'),
  '@localixai/plugin-sdk/document-layout': () => import('@localixai/plugin-sdk/document-layout'),
  '@localixai/plugin-sdk/navigation': () => import('@localixai/plugin-sdk/navigation'),
  '@localixai/plugin-sdk/session-resource': () => import('@localixai/plugin-sdk/session-resource'),
  '@localixai/plugin-sdk/resource-refs': () => import('@localixai/plugin-sdk/resource-refs'),
  '@localixai/plugin-sdk/typed-error': () => import('@localixai/plugin-sdk/typed-error'),
  '@localixai/plugin-sdk/prerequisite': () => import('@localixai/plugin-sdk/prerequisite'),
  // Shared, not bundled: it reads the host's work-item session context and runtime.
  '@localixai/plugin-sdk/ui/prerequisite-recovery': () =>
    import('@localixai/plugin-sdk/ui/prerequisite-recovery'),
}

/**
 * Every non-kit specifier the host shares. Staging reads it (`scripts/stage-plugin-kit.mjs`) to
 * record each module's export names in the plugin kit, so a plugin build anywhere shims exactly
 * what this registry provides.
 */
export const HOST_SHARED_SPECIFIERS: readonly string[] = [
  ...Object.keys(CORE),
  ...Object.keys(SDK_SHARED_MODULES),
]

/** Vite defines `SSR` as a boolean in every transform; a bare `bun test` leaves it undefined. */
const underVite = typeof (import.meta.env as { SSR?: unknown } | undefined)?.SSR === 'boolean'

// `@localixai/kit/<id>` has two providers: a door of the kit package (`packages/kit/src/entries`,
// what the app itself imports) and a module the host LENDS because it is bound to a host feature
// (`app/kit/*.ts`). A glob over each keeps the registry equal to those two directories without a
// second list; `pluginSharedModules.test.ts` pins that no id has both. `testing/` is not matched.
// `import.meta.glob` is a compile-time macro, so it only exists under Vite. The door glob is a
// path, not the package name, because a glob cannot follow a specifier — Vite resolves both to the
// same file, so the plugin and the app share one module instance.
const KIT_DOORS = underVite
  ? import.meta.glob<Record<string, unknown>>('../../../../packages/kit/src/entries/*.ts')
  : {}
const HOST_LENT = underVite ? import.meta.glob<Record<string, unknown>>('./kit/*.ts') : {}
const kitSpecifier = (path: string): string =>
  `${PLUGIN_UI_KIT_PREFIX}${/\/([^/]+)\.ts$/u.exec(path)?.[1] ?? path}`
const KIT: Record<string, Loader> = Object.fromEntries(
  [...Object.entries(KIT_DOORS), ...Object.entries(HOST_LENT)].map(([path, load]) => [
    kitSpecifier(path),
    load,
  ]),
)

/** Whether the page that owns the registry is still live — false from its `pagehide` on. */
export interface PageLifetime {
  alive(): boolean
}

/**
 * The live page's lifetime, flipped by `pagehide`, which fires before a reload or navigation
 * detaches the document.
 *
 * Why the registry cares — the defect this exists to stop: every shared import in a plugin chunk
 * is `await host.load(specifier)` at the chunk's TOP LEVEL. When the page reloads while a chunk
 * is paused there (Vite's full reload, the port-change reload on a cold start, an error-boundary
 * or restart reload) and the load then settles, WebKit resumes the module in a DETACHED document:
 * `ScriptModuleLoader::evaluate` returns without running it, the module's state never moves, and
 * JSC's `asyncModuleEvaluation` loop awaits and evaluates again forever — one microtask each, on
 * the event loop the NEW page shares, so the new page never paints or takes a click again. It was
 * sampled as 100% CPU in `moduleLoaderEvaluate` → `URL::URL`, and only a restart recovered it.
 * A load that never settles after `pagehide` leaves the paused module paused; it is collected
 * with its document instead of spinning.
 */
function pageLifetime(): PageLifetime {
  let alive = true
  let suppressed = false
  const scope = globalThis as { addEventListener?: Window['addEventListener'] }
  scope.addEventListener?.('pagehide', () => {
    alive = false
  })
  // A page restored from the back/forward cache comes back with the loads it suppressed still
  // unanswered; its plugin chunks would wait forever, so it starts over instead.
  scope.addEventListener?.('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return
    alive = true
    if (suppressed) globalThis.location?.reload()
  })
  return {
    alive: () => {
      if (!alive) suppressed = true
      return alive
    },
  }
}

export function createPluginSharedModules(
  loaders: Readonly<Record<string, Loader>>,
  lifetime: PageLifetime = pageLifetime(),
): PluginUiSharedModules {
  const loading = new Map<string, Promise<Record<string, unknown>>>()
  const loaded = new Map<string, Record<string, unknown>>()
  const refuse = (specifier: string) =>
    new Error(
      `[plugin-ui] the host does not provide "${specifier}" — import it from a kit module ` +
        'or bundle it with the plugin',
    )
  const never = () => new Promise<never>(() => {})
  /** Settles like `promise` while the page lives; after `pagehide`, never (see `pageLifetime`). */
  const whileAlive = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolveLoad, rejectLoad) => {
      promise.then(
        (value) => {
          if (lifetime.alive()) resolveLoad(value)
        },
        (error: unknown) => {
          if (lifetime.alive()) rejectLoad(error)
        },
      )
    })
  return {
    load(specifier) {
      if (!lifetime.alive()) return never()
      const known = loading.get(specifier)
      if (known) return known
      const load = isPluginUiSharedModule(specifier) ? loaders[specifier] : undefined
      if (!load) return Promise.reject(refuse(specifier))
      const next = whileAlive(
        load().then((module) => {
          loaded.set(specifier, module)
          return module
        }),
      )
      loading.set(specifier, next)
      // A failed load (a chunk error) must not poison the next attempt.
      next.catch(() => loading.delete(specifier))
      return next
    },
    require(specifier) {
      const module = loaded.get(specifier)
      if (module) return module
      if (!loaders[specifier] || !isPluginUiSharedModule(specifier)) throw refuse(specifier)
      throw new Error(
        `[plugin-ui] "${specifier}" was required before the host loaded it; only ` +
          `${PLUGIN_UI_PRELOADED_MODULES.join(', ')} can be required synchronously`,
      )
    },
  }
}

/**
 * Install the registry under the SDK's global, once, at boot. The app layer composes it (the kit
 * re-exports features); the plugin UI runtime in `shared/contrib` reads it only through the SDK
 * contract, so no lower layer imports the kit.
 */
export function installPluginSharedModules(): PluginUiSharedModules {
  const scope = globalThis as unknown as Record<string, PluginUiSharedModules | undefined>
  scope[PLUGIN_UI_SHARED_GLOBAL] ??= createPluginSharedModules({
    ...CORE,
    ...SDK_SHARED_MODULES,
    ...KIT,
  })
  return scope[PLUGIN_UI_SHARED_GLOBAL]
}

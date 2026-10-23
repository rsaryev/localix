import {
  MINI_APP_UI_KIT_PREFIX,
  MINI_APP_UI_PRELOADED_MODULES,
  MINI_APP_UI_SHARED_GLOBAL,
  isMiniAppUiSharedModule,
  type MiniAppUiSharedModules,
} from '@localixai/mini-app-sdk/ui-artifact'

/**
 * The host's side of the shared-module contract: the ONE instance of React, of the mini app SDK
 * and of the host UI kit that every mini app artifact runs against.
 *
 * A mini app artifact bundles everything else itself. These cannot be bundled twice: a second React
 * breaks hooks, a second SDK has unbound transport and empty command maps, a second kit component
 * reads contexts the host never provided. So the artifact's build turns each import of one of
 * them into `await host.load(specifier)`, and this registry answers with the module the host
 * itself uses — loaded on first request, so a kit module (Monaco behind the code editor) costs
 * nothing until a mini app chunk that needs it is opened.
 *
 * Every entry is a literal `import()`, which is what lets the bundler give the host and the
 * mini apps the same module instance.
 */
type Loader = () => Promise<Record<string, unknown>>

const CORE: Record<string, Loader> = {
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react/jsx-dev-runtime': () => import('react/jsx-dev-runtime'),
  'react-dom': () => import('react-dom'),
  'react-dom/client': () => import('react-dom/client'),
}

/**
 * Every browser-side SDK entry (`miniAppSharedModules.test.ts` pins this to the package exports).
 */
export const SDK_SHARED_MODULES: Record<string, Loader> = {
  '@localixai/mini-app-sdk/manifest-label': () => import('@localixai/mini-app-sdk/manifest-label'),
  '@localixai/mini-app-sdk/manifest-primitives': () =>
    import('@localixai/mini-app-sdk/manifest-primitives'),
  '@localixai/mini-app-sdk/ui': () => import('@localixai/mini-app-sdk/ui'),
  '@localixai/mini-app-sdk/ui/chart-export': () =>
    import('@localixai/mini-app-sdk/ui/chart-export'),
  '@localixai/mini-app-sdk/ui/charts': () => import('@localixai/mini-app-sdk/ui/charts'),
  '@localixai/mini-app-sdk/ui/classes': () => import('@localixai/mini-app-sdk/ui/classes'),
  '@localixai/mini-app-sdk/ui/commands': () => import('@localixai/mini-app-sdk/ui/commands'),
  '@localixai/mini-app-sdk/ui/comments': () => import('@localixai/mini-app-sdk/ui/comments'),
  '@localixai/mini-app-sdk/ui/components': () => import('@localixai/mini-app-sdk/ui/components'),
  '@localixai/mini-app-sdk/ui/file-types': () => import('@localixai/mini-app-sdk/ui/file-types'),
  '@localixai/mini-app-sdk/ui/focus': () => import('@localixai/mini-app-sdk/ui/focus'),
  '@localixai/mini-app-sdk/ui/interactions': () =>
    import('@localixai/mini-app-sdk/ui/interactions'),
  '@localixai/mini-app-sdk/ui/message-binding-drag': () =>
    import('@localixai/mini-app-sdk/ui/message-binding-drag'),
  '@localixai/mini-app-sdk/ui/path-tree': () => import('@localixai/mini-app-sdk/ui/path-tree'),
  '@localixai/mini-app-sdk/ui/problems': () => import('@localixai/mini-app-sdk/ui/problems'),
  '@localixai/mini-app-sdk/ui/store-resource': () =>
    import('@localixai/mini-app-sdk/ui/store-resource'),
  '@localixai/mini-app-sdk/ui/route-snapshot': () =>
    import('@localixai/mini-app-sdk/ui/route-snapshot'),
  '@localixai/mini-app-sdk/ui/store-snapshot': () =>
    import('@localixai/mini-app-sdk/ui/store-snapshot'),
  '@localixai/mini-app-sdk/ui/now': () => import('@localixai/mini-app-sdk/ui/now'),
  '@localixai/mini-app-sdk/ui/game-table': () => import('@localixai/mini-app-sdk/ui/game-table'),
  '@localixai/mini-app-sdk/ui/session-game': () =>
    import('@localixai/mini-app-sdk/ui/session-game'),
  '@localixai/mini-app-sdk/ui/resource-sync': () =>
    import('@localixai/mini-app-sdk/ui/resource-sync'),
  '@localixai/mini-app-sdk/ui/file-resource-sync': () =>
    import('@localixai/mini-app-sdk/ui/file-resource-sync'),
  '@localixai/mini-app-sdk/ui/realtime-feed': () =>
    import('@localixai/mini-app-sdk/ui/realtime-feed'),
  '@localixai/mini-app-sdk/ui/resource-topics': () =>
    import('@localixai/mini-app-sdk/ui/resource-topics'),
  '@localixai/mini-app-sdk/ui/result-count-status': () =>
    import('@localixai/mini-app-sdk/ui/result-count-status'),
  '@localixai/mini-app-sdk/ui/runtime': () => import('@localixai/mini-app-sdk/ui/runtime'),
  '@localixai/mini-app-sdk/ui/runtime-hooks': () =>
    import('@localixai/mini-app-sdk/ui/runtime-hooks'),
  '@localixai/mini-app-sdk/ui/segmented-control': () =>
    import('@localixai/mini-app-sdk/ui/segmented-control'),
  '@localixai/mini-app-sdk/ui/session-activity': () =>
    import('@localixai/mini-app-sdk/ui/session-activity'),
  '@localixai/mini-app-sdk/ui/session-tree': () =>
    import('@localixai/mini-app-sdk/ui/session-tree'),
  '@localixai/mini-app-sdk/ui/shared-resource': () =>
    import('@localixai/mini-app-sdk/ui/shared-resource'),
  '@localixai/mini-app-sdk/ui/stats-charts': () =>
    import('@localixai/mini-app-sdk/ui/stats-charts'),
  '@localixai/mini-app-sdk/ui/storage': () => import('@localixai/mini-app-sdk/ui/storage'),
  '@localixai/mini-app-sdk/ui/table': () => import('@localixai/mini-app-sdk/ui/table'),
  '@localixai/mini-app-sdk/ui/transport': () => import('@localixai/mini-app-sdk/ui/transport'),
  '@localixai/mini-app-sdk/ui/use-problem-report': () =>
    import('@localixai/mini-app-sdk/ui/use-problem-report'),
  '@localixai/mini-app-sdk/ui/utilities': () => import('@localixai/mini-app-sdk/ui/utilities'),
  '@localixai/mini-app-sdk/ui/visibility': () => import('@localixai/mini-app-sdk/ui/visibility'),
  // The host's own instance: its provider and a mini app's `useWorkItemSessionId` must share one
  // React context, or every mini app tab would read no session at all.
  '@localixai/mini-app-sdk/ui/work-item-session': () =>
    import('@localixai/mini-app-sdk/ui/work-item-session'),
  '@localixai/mini-app-sdk/rich-text': () => import('@localixai/mini-app-sdk/rich-text'),
  '@localixai/mini-app-sdk/store-changes': () => import('@localixai/mini-app-sdk/store-changes'),
  '@localixai/mini-app-sdk/document-layout': () =>
    import('@localixai/mini-app-sdk/document-layout'),
  '@localixai/mini-app-sdk/agent-wait': () => import('@localixai/mini-app-sdk/agent-wait'),
  '@localixai/mini-app-sdk/opponent': () => import('@localixai/mini-app-sdk/opponent'),
  '@localixai/mini-app-sdk/sealed': () => import('@localixai/mini-app-sdk/sealed'),
  '@localixai/mini-app-sdk/bounded-cache': () => import('@localixai/mini-app-sdk/bounded-cache'),
  '@localixai/mini-app-sdk/secret-shapes': () => import('@localixai/mini-app-sdk/secret-shapes'),
  '@localixai/mini-app-sdk/navigation': () => import('@localixai/mini-app-sdk/navigation'),
  '@localixai/mini-app-sdk/session-resource': () =>
    import('@localixai/mini-app-sdk/session-resource'),
  '@localixai/mini-app-sdk/resource-refs': () => import('@localixai/mini-app-sdk/resource-refs'),
  '@localixai/mini-app-sdk/typed-error': () => import('@localixai/mini-app-sdk/typed-error'),
  '@localixai/mini-app-sdk/prerequisite': () => import('@localixai/mini-app-sdk/prerequisite'),
  // Shared, not bundled: it reads the host's work-item session context and runtime.
  '@localixai/mini-app-sdk/ui/prerequisite-recovery': () =>
    import('@localixai/mini-app-sdk/ui/prerequisite-recovery'),
}

/**
 * Every non-kit specifier the host shares. Staging reads it (`scripts/stage-mini-app-kit.mjs`) to
 * record each module's export names in the mini app kit, so a mini app build anywhere shims exactly
 * what this registry provides.
 * @public
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
// second list; `miniAppSharedModules.test.ts` pins that no id has both. `testing/` is not matched.
// `import.meta.glob` is a compile-time macro, so it only exists under Vite. The door glob is a
// path, not the package name, because a glob cannot follow a specifier — Vite resolves both to the
// same file, so the mini app and the app share one module instance.
const KIT_DOORS = underVite
  ? import.meta.glob<Record<string, unknown>>('../../../../packages/kit/src/entries/*.ts')
  : {}
const HOST_LENT = underVite ? import.meta.glob<Record<string, unknown>>('./kit/*.ts') : {}
const kitSpecifier = (path: string): string =>
  `${MINI_APP_UI_KIT_PREFIX}${/\/([^/]+)\.ts$/u.exec(path)?.[1] ?? path}`
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
 * Why the registry cares — the defect this exists to stop: every shared import in a mini app chunk
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
  // unanswered; its mini app chunks would wait forever, so it starts over instead.
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

export function createMiniAppSharedModules(
  loaders: Readonly<Record<string, Loader>>,
  lifetime: PageLifetime = pageLifetime(),
): MiniAppUiSharedModules {
  const loading = new Map<string, Promise<Record<string, unknown>>>()
  const loaded = new Map<string, Record<string, unknown>>()
  const refuse = (specifier: string) =>
    new Error(
      `[mini-app-ui] the host does not provide "${specifier}" — import it from a kit module ` +
        'or bundle it with the mini app',
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
      const load = isMiniAppUiSharedModule(specifier) ? loaders[specifier] : undefined
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
      if (!loaders[specifier] || !isMiniAppUiSharedModule(specifier)) throw refuse(specifier)
      throw new Error(
        `[mini-app-ui] "${specifier}" was required before the host loaded it; only ` +
          `${MINI_APP_UI_PRELOADED_MODULES.join(', ')} can be required synchronously`,
      )
    },
  }
}

/**
 * Install the registry under the SDK's global, once, at boot. The app layer composes it (the kit
 * re-exports features); the mini app UI runtime in `shared/contrib` reads it only through the SDK
 * contract, so no lower layer imports the kit.
 */
export function installMiniAppSharedModules(): MiniAppUiSharedModules {
  const scope = globalThis as unknown as Record<string, MiniAppUiSharedModules | undefined>
  scope[MINI_APP_UI_SHARED_GLOBAL] ??= createMiniAppSharedModules({
    ...CORE,
    ...SDK_SHARED_MODULES,
    ...KIT,
  })
  return scope[MINI_APP_UI_SHARED_GLOBAL]
}

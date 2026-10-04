import { GlobalRegistrator } from '@happy-dom/global-registrator'

let activeDomUsers = 0
let ownsDomRegistration = false

/**
 * Register happy-dom globals for DOM-mounting UI tests (widgets need a real
 * `document`). Register/unregister are scoped per test FILE via before/afterAll so a
 * DOM test can't leak globals into the pure-logic suites that run in the same
 * `bun test` process. Returns the teardown to call in `afterAll`.
 *
 * Load react-dom INSIDE the test — `const { createRoot } = await import('react-dom/client')`
 * — never at module scope. bun evaluates every test file's module graph before any
 * registration hook runs, so a static import initializes react-dom while there is no
 * `document`. When one file did that, `bun test src/features/inspector src/features/source-control`
 * failed `CommitBox.dom.test.tsx` (React synthetic events stopped arriving there at all) in
 * either file order, while each file passed alone — the full suite stayed green, which is what
 * made it expensive to find. `check:architecture` now enforces this.
 */
export function registerDom(): () => Promise<void> {
  if (activeDomUsers === 0 && typeof document === 'undefined') {
    GlobalRegistrator.register()
    ownsDomRegistration = true
  }
  activeDomUsers += 1

  let released = false
  return async () => {
    if (released) return
    released = true
    activeDomUsers = Math.max(0, activeDomUsers - 1)
    if (activeDomUsers !== 0 || !ownsDomRegistration) return
    ownsDomRegistration = false
    await GlobalRegistrator.unregister()
  }
}

/**
 * Install a stub `localStorage` for a suite that has no DOM.
 *
 * `defineProperty`, never a plain assignment: while any suite in this `bun test`
 * process holds a registered DOM, `globalThis.localStorage` is a READONLY accessor and
 * `globalThis.localStorage = …` throws "Attempted to assign to readonly property"
 * before the test body runs. Two suites failed exactly that way under
 * `--randomize` while passing in declaration order.
 */
export function installTestLocalStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true,
  })
}

/** Remove it again — `delete` cannot drop a non-configurable DOM-provided property. */
export function removeTestLocalStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage')
}

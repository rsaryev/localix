// apps/ui test preload. Replaces `packages/kit/test-preload.ts` for this package so the suite
// can run under `bun test --isolate` / `--parallel`.
//
// An inherited production environment makes React load its production bundle, which
// intentionally omits `act`. Tests need React's test bundle regardless of the caller.
process.env.NODE_ENV = 'test'

// Radix freezes its layout-effect hook at module evaluation:
//
//     var useLayoutEffect = globalThis?.document ? React.useLayoutEffect : () => {}
//
// Evaluated without a document the hook is a permanent no-op, portals never mount, and every
// menu and dialog renders nothing. Many suites import Radix statically and only register a DOM
// in `beforeAll`, so we hold a DOM while each test file's module graph evaluates (every copy
// of the shim — ESM, CJS, nested installs — then binds the real hook) and release it before
// the file's own hooks run; `registerDom()` scoping is unchanged.
//
// No top-level `await`: under `--isolate` bun starts the test file once the preload's
// synchronous part has run, so anything after an `await` (the kit preload's warm-up import)
// arrives too late and Radix was bound to the no-op in every isolated file.
import { beforeAll } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { installNetworkGuard } from './networkGuard'

// Guard Bun's fetch before registering, so unregistering restores the guarded one.
installNetworkGuard()
GlobalRegistrator.register()
beforeAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
})

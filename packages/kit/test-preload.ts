// An inherited production environment makes React load its production bundle, which
// intentionally omits `act`. Tests need React's test bundle regardless of the caller.
process.env.NODE_ENV = 'test'

// Decide Radix's layout-effect hook ONCE, with a document present.
//
// Radix freezes it at module-evaluation time:
//
//     var useLayoutEffect = globalThis?.document ? React.useLayoutEffect : () => {}
//
// and `@radix-ui/react-portal` builds on it: `useLayoutEffect(() => setMounted(true), [])`,
// rendering `container ? createPortal(…) : null`. Evaluated without a document the hook
// is a permanent no-op, `mounted` never flips, and EVERY portal-based dialog in the
// process renders nothing — no error, no warning, just an empty document.
//
// `bun test` shares one process and shuffles file order, so which suite first pulls in
// Radix is luck. **35 test files reach it statically without holding a DOM** (they render
// to static markup, or assert on presentation props) — any one of them can poison the
// run. That is what made eight dialog suites fail under `--randomize` while passing
// alone; see git 98607cd6f for the investigation.
//
// Warming it here fixes the class instead of the 35 files: register a DOM, evaluate the
// Radix graph so every copy of the shim binds the real hook, then unregister so the
// per-file scoping in `src/testing/dom.ts` is untouched — this leaves
// `globalThis.document` undefined again, exactly as before.
const { GlobalRegistrator } = await import('@happy-dom/global-registrator')
GlobalRegistrator.register()
try {
  await import('radix-ui')
} finally {
  await GlobalRegistrator.unregister()
}

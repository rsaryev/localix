// The mini app owns its test runtime. Radix is warmed by the kit preload chained before this
// file in `bunfig.toml`, not here.
process.env.NODE_ENV = 'test'

export {}

// Problem surfaces come from the host. A mini app test renders them without a host, so it binds the
// SDK's stand-ins — the same doubles reader and database use, rather than a fourth copy of them.
// Re-bound per test because a suite that imports the real host runtime replaces the binding with a
// lazy component, which renders as nothing under `renderToStaticMarkup`.
const { beforeEach } = await import('bun:test')
const { bindMiniAppUiTestDoubles } = await import('@localixai/mini-app-sdk/ui/testing')

bindMiniAppUiTestDoubles()
beforeEach(bindMiniAppUiTestDoubles)

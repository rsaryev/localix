// The plugin owns its test runtime.
process.env.NODE_ENV = 'test'

export {}

// Problem surfaces come from the host, and a plugin test has no host. The doubles are the SDK's, so
// this plugin is not maintaining its own idea of what a problem line looks like. Bound ONCE, at
// preload: a suite that pulls in the real host runtime rebinds afterwards and must win, or its own
// surfaces (the data grid, the editor tab) would be replaced by these stubs.
const { bindPluginUiTestDoubles } = await import('@localixai/mini-app-sdk/ui/testing')
bindPluginUiTestDoubles()

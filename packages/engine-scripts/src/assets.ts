/**
 * The sandbox's files as a BUNDLED host carries them beside its entry bundle: the worker a VM
 * starts in, the QuickJS binary it runs, and the extensions a long-lived VM loads. One owner for
 * the names, read by the sandbox that looks for them and by the desktop build that writes them
 * (`apps/desktop-tauri/scripts/prepare-sidecar.mjs`, which bundles the worker from this package's
 * `./worker` export). Imports nothing, so a build script can load it.
 */
export const SCRIPT_WORKER_FILE = 'script-worker.js'
export const SCRIPT_WASM_FILE = 'quickjs.wasm'

/**
 * The QuickJS extensions a long-lived VM (`vm.ts`) loads, by the name `quickjs-wasi` exports each
 * under (`quickjs-wasi/<name>.so`), with the file a bundled host keeps it in: the web APIs QuickJS
 * itself lacks — `URL`, `TextEncoder`, `Headers`, `crypto` and `structuredClone`.
 */
export const SCRIPT_EXTENSION_FILES = {
  url: 'quickjs-url.so',
  encoding: 'quickjs-encoding.so',
  headers: 'quickjs-headers.so',
  crypto: 'quickjs-crypto.so',
  'structured-clone': 'quickjs-structured-clone.so',
} as const

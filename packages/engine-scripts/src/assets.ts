/**
 * The sandbox's two files as a BUNDLED host carries them beside its entry bundle: the worker a
 * script's VM starts in, and the QuickJS binary it runs. One owner for both names, read by the
 * sandbox that looks for them and by the desktop build that writes them
 * (`apps/desktop-tauri/scripts/prepare-sidecar.mjs`). Imports nothing, so a build script can load it.
 */
export const SCRIPT_WORKER_FILE = 'script-worker.js'
export const SCRIPT_WASM_FILE = 'quickjs.wasm'
/** The worker's source entry, relative to this package, for the build that bundles it. */
export const SCRIPT_WORKER_ENTRY = 'src/worker.ts'

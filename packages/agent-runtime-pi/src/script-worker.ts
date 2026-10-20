/**
 * The script sandbox's worker entry for a BUNDLED host (the desktop sidecar's `server.js`).
 *
 * The sandbox starts each script's VM in a worker thread from a file beside the module that creates
 * it. A bundle has no such file, so the sidecar build adds this module as an entry of its own,
 * written next to `server.js` as `SCRIPT_WORKER_FILE` (`script-assets.ts`), where
 * `bundledScriptSandboxOptions` finds it. In development the package's own worker is used and this file is never loaded.
 */
import '@earendil-works/pi-codemode/worker'

// Run the mini app kit stager as a child (`stage-mini-app-kit.mjs`): it uses the async bundler,
// and a second in-process build of the SDK's own modules trips a Bun resolver error. The one
// implementation the packager (`prepare-sidecar.mjs`) and development (`dev-api.mjs`) call.
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KIT_STAGER = fileURLToPath(new URL('./stage-mini-app-kit.mjs', import.meta.url))

/** `--cache=<dir>` when the caller keeps a kit cache (development); packaging stages fresh. */
const stagerArgs = (repoRoot, outKit, cacheRoot) => [
  KIT_STAGER,
  repoRoot,
  outKit,
  ...(cacheRoot ? [`--cache=${cacheRoot}`] : []),
]

/**
 * Stage the mini app kit into `outKit`. A failure is always fatal: an app without its kit cannot
 * serve the authoring plugin anything to build against.
 */
export function stageMiniAppKitInto({ repoRoot, outKit, cacheRoot, run = execFileSync }) {
  run('bun', stagerArgs(repoRoot, outKit, cacheRoot), { cwd: repoRoot, stdio: 'inherit' })
}

/**
 * {@link stageMiniAppKitInto} without blocking the caller: the dev supervisor re-stages the kit
 * while it also supervises the API, and a synchronous child stalled it for the ~3s a stage takes.
 * Resolves when the stage succeeds, rejects with its exit status otherwise.
 */
export function stageMiniAppKitIntoAsync({ repoRoot, outKit, cacheRoot, run = spawn }) {
  return new Promise((resolveStage, rejectStage) => {
    const child = run('bun', stagerArgs(repoRoot, outKit, cacheRoot), {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.once('error', rejectStage)
    child.once('exit', (code, signal) =>
      code === 0
        ? resolveStage()
        : rejectStage(new Error(`the mini app kit stager exited with ${signal ?? code}`)),
    )
  })
}

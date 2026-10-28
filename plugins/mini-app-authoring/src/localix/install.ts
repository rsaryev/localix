import { UserError } from '../lib/errors'
import {
  findLocalix,
  installedLocalixApp,
  localixRequest,
  type LocalixRuntime,
  type RuntimeDeps,
} from './runtime'

/**
 * Handing a built package to Localix. Localix validates it, installs it as the person's own mini
 * app (no catalog updates or removes it), switches it on and swaps it into any open view. The
 * toolchain never writes into Localix's folders itself: installing is Localix's job.
 */

export interface InstalledApp {
  name: string
  version: string
  /** Problems Localix found that did not stop the install (store media, for one). */
  warnings: string[]
}

export interface InstallDeps extends RuntimeDeps {
  /** Starts the installed app; the default opens it with the system. */
  launch?: (app: string) => Promise<void>
  /** How long to wait for a launched Localix to answer. */
  waitMs?: number
  sleep?: (ms: number) => Promise<void>
  /** The installed app, when the caller already looked (tests pass one, or null). */
  app?: string | null
}

const defaultLaunch = async (app: string) => {
  const child = Bun.spawn(['open', '-a', app], { stdout: 'ignore', stderr: 'pipe' })
  if ((await child.exited) !== 0) throw new UserError(`Could not open ${app}.`)
}

/** The running Localix, starting the installed app when it is not running. */
export async function reachLocalix(deps: InstallDeps = {}): Promise<LocalixRuntime> {
  const running = await findLocalix(deps)
  if (running) return running
  const app = deps.app === undefined ? installedLocalixApp(deps.home) : deps.app
  if (!app) {
    throw new UserError(
      'Localix is not installed on this computer. `mini-app get-localix` installs it; the package is ready to install after that.',
    )
  }
  await (deps.launch ?? defaultLaunch)(app)
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms))
  const deadline = Date.now() + (deps.waitMs ?? 60_000)
  while (Date.now() < deadline) {
    const runtime = await findLocalix(deps)
    if (runtime) return runtime
    await sleep(500)
  }
  throw new UserError(
    'Localix was opened but did not answer within a minute; try again once it is up.',
  )
}

/** An install copies a whole package: it may take far longer than a status request. */
const INSTALL_TIMEOUT_MS = 120_000

/** Install the package at `packageDir`, built from the source at `sourceDir`. */
export async function installIntoLocalix(
  packageDir: string,
  sourceDir: string,
  deps: InstallDeps = {},
): Promise<InstalledApp> {
  const runtime = await reachLocalix(deps)
  return localixRequest<InstalledApp>(
    runtime,
    '/rpc/mini-apps/install-local',
    { method: 'POST', body: { dir: packageDir, source: sourceDir }, timeoutMs: INSTALL_TIMEOUT_MS },
    deps.fetch,
  )
}

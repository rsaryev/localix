import { loadLoginShellEnv, loginShellEnvSource } from '../lib/login-shell-env'
import { startCoreReactors, type CoreReactorDeps } from './core-reactors'
import { startSemantic } from './semantic-changes'
import { startModelStatusPokes } from './status-pokes'

/**
 * What starts once the server is listening: the subsystems that spawn from `process.env`, after the
 * user's login-shell environment is folded into it.
 *
 * GUI launches (desktop app, .desktop entry) inherit a bare launchd/systemd env — no
 * version-manager dirs on PATH, no SHELL — so child processes across ANY stack (node/npm,
 * python/pyenv, ruby, cargo, go, git, language servers, MCP servers) fail with "command not found"
 * even though they work in the user's terminal. The user's real login-shell env is folded into
 * process.env ONCE so downstream spawns that spread `{...process.env}` inherit it. No-op from a
 * terminal. (The foreground bash / ripgrep path passes `childEnv()` explicitly — under Bun a spawn
 * with no `env` only ever sees the process-start snapshot.)
 *
 * Non-blocking, and the subsystems that spawn from `process.env` wait for it. The probe used to
 * block JS on this turn, BEFORE the endpoint was published — 330 ms on a cache miss, and up to
 * 10 s with a slow rc against the desktop shell's 12 s start deadline, which then killed and
 * retried the launch. Now READY no longer waits on the user's rc files; the backend host, engines
 * and timers start once `envReady` settles (a snapshot hit settles on this turn); and a request
 * that spawns earlier gets a correct env from `childEnv()`, which resolves synchronously rather
 * than hand out a half-repaired one. A stop that lands first (`signal`) must not have its
 * torn-down subsystems restarted.
 */
export function startAfterListen(
  deps: {
    logger: { info: (entry: object) => void; warn: (entry: object) => void }
    /** The hosts, engines and timers, in the order they start. */
    start: () => void
    semantic: Omit<Parameters<typeof startSemantic>[0], 'signal'>
    statusPokes: Omit<Parameters<typeof startModelStatusPokes>[0], 'signal'>
    coreReactors: CoreReactorDeps
  },
  signal?: AbortSignal,
): Promise<void> {
  const { logger } = deps
  const envStartedAt = performance.now()
  return loadLoginShellEnv().then(() => {
    const ms = Math.round(performance.now() - envStartedAt)
    logger.info({ event: 'startup.env_ready', ms, cache: loginShellEnvSource() })
    if (signal?.aborted) return
    deps.start()
    startSemantic({ ...deps.semantic, signal })
    startModelStatusPokes({ ...deps.statusPokes, signal })
    void startCoreReactors(deps.coreReactors).catch((err: unknown) =>
      logger.warn({ event: 'core_reactors.start_failed', error: String(err) }),
    )
  })
}

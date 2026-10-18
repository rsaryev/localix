import type pino from 'pino'
import { once } from 'node:events'
import { readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { bootstrap } from './bootstrap'
import { endpointPort, isOwnDescriptor, spawnDetachedDaemon, stopRuntime } from './runtime-daemon'
import { randomUUID } from 'node:crypto'
import { disposePreviewServers } from './features/agent-core/tools/preview/preview-probe'
import {
  assertNoLiveRuntimeEndpoint,
  acquireRuntimeOwnership,
  clearRuntimeEndpoint,
  discoverRuntimeEndpoint,
  dialableRuntimeBaseUrl,
  legacyRuntimeEndpointFile,
  publishRuntimeEndpoint,
  readRuntimeEndpoint,
  resolveRuntimeIdentity,
  runtimeOwnershipIsHeld,
  RuntimeOwnershipHeldError,
  type RuntimeEndpoint,
  waitForRuntimeEndpoint,
} from './lib/runtime-endpoint'
import { owningShellPid, RuntimeOwnedElsewhereError } from './lib/runtime-shell-owner'
import {
  DESKTOP_RUNTIME_ARG,
  LOCALIX_API_PROTOCOL_VERSION,
  LOCALIX_RUNTIME_OWNED_ELSEWHERE_PREFIX,
  LOCALIX_RUNTIME_READY_PREFIX,
  RUNTIME_EXIT_OWNED_ELSEWHERE,
  RUNTIME_ATTACH_WAIT_MS,
  RUNTIME_ENV,
  RUNTIME_SHUTDOWN_DEADLINE_MS,
} from './lib/runtime-protocol'
import { MAX_REQUEST_BODY_BYTES } from './lib/request-limits'
import { runtimeBaseUrlMatchesHost } from './lib/runtime-address'
import { defaultDbFile, envFlag, envString, resolveDbFile } from './lib/env'
import { captureConsoleDiagnostics, createLogger } from './lib/logger'
import { createRuntimeLogDestination, runtimeLogFile } from './lib/runtime-log-destination'
import { installServerSignalHandlers } from './lib/process-signals'
import { armShutdownDeadline } from './lib/shutdown-deadline'
import { installOrphanGuard } from './lib/orphan-guard'
import { startupDiag } from './lib/startup-diagnostics'
import { createShutdownSteps } from './lib/shutdown-steps'
import { isSameBuild, runtimeBuildId } from './lib/runtime-build'
import {
  currentStdinFacts,
  stdinIsParentPipe,
  watchParentStdin,
  watchShutdownCommand,
} from './lib/desktop-parent'

/** A running API owned by the daemon process. */
export interface EmbeddedServer {
  baseUrl: string
  port: number
  /** Graceful, idempotent teardown: the same sequence the signal handlers run —
   *  drain platform channels, abort runs, kill PTY/LSP/plugin children, release
   *  ownership, close the DB. Safe to call more than once. */
  stop: () => Promise<void>
}

async function restoreWatchPort(): Promise<void> {
  if (!envFlag('LOCALIX_RUNTIME_WATCH')) return
  const identity = await resolveRuntimeIdentity()
  const previous = await readRuntimeEndpoint(identity.endpointFile)
  if (previous?.pid !== process.pid || previous.runtimeMode !== 'development-watch') return
  const port = new URL(previous.baseUrl).port
  if (port) Object.assign(process.env, { PORT: port })
}

async function closeLogDestination(
  destination: ReturnType<typeof pino.destination> | undefined,
): Promise<void> {
  if (!destination) return
  const finished = once(destination, 'finish')
  destination.end()
  await finished
}

/**
 * How long the WHOLE graceful teardown gets before the process leaves anyway.
 *
 * The teardown in `stop()` is a sequence of awaits over subsystems that own FOREIGN
 * children — PTYs, language servers, plugin backends, preview servers. Any one of them
 * can fail to settle, and until this deadline existed that outcome was a process which
 * had already stopped serving, never reached `runtimeOwnership.release()`, and went on
 * holding the runtime lease forever. The next launch then waited for an endpoint that
 * could never appear, the desktop shell killed it at its own deadline, and the app was
 * unstartable until `~/.localix` was deleted — which "works" only because a fresh lease
 * file gets a fresh inode while the wedged holder keeps the old one.
 *
 * LEAVING is what releases the lease: the kernel closes the SQLite handle on exit. So a
 * bounded, possibly-incomplete teardown is strictly better than an unbounded one — the
 * alternative was never "a clean shutdown", it was "no shutdown at all".
 *
 * Sized under the desktop shell's own force-kill (`sidecar.rs`), which waits a second
 * longer, so the runtime always gets to finish on its own terms first.
 */
const SHUTDOWN_DEADLINE_MS = RUNTIME_SHUTDOWN_DEADLINE_MS

/** Per-step budget, so one wedged subsystem cannot spend the whole deadline alone. */
const SHUTDOWN_STEP_MS = 1_500

/** Closing the listener and its connections is immediate; waiting longer only spends the deadline. */
const SERVER_STOP_MS = 750

/**
 * Is this the "someone else already has that port" failure?
 *
 * Both spellings on purpose: Bun surfaces the errno as `code` on its own errors, but the
 * value travels as text through wrappers and across versions, and a classifier that reads
 * only one of the two silently stops matching the day the other shows up.
 */
function isAddressInUse(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'EADDRINUSE') return true
  return error instanceof Error && /EADDRINUSE|address already in use/i.test(error.message)
}

/**
 * Drop the ownership artifacts THIS process published, synchronously.
 *
 * Only reachable from the force-exit path, where nothing may be awaited. The lease needs
 * no help — the kernel releases it — but the compatibility lock and the endpoint
 * descriptors are plain files, and leaving ours behind makes the next start do reclaim
 * work it should not have to. Every unlink is guarded by "does this file still name US",
 * so a file another runtime has already taken over is never removed.
 */
function dropOwnershipArtifactsSync(files: readonly string[]): void {
  for (const file of files) {
    try {
      const owner = JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown }
      if (owner.pid !== process.pid) continue
      unlinkSync(file)
    } catch {}
  }
}

export interface StartServerOptions {
  /**
   * Route pino logs to this file instead of stdout. `true` selects the
   * canonical runtime log beside the active database.
   */
  logFile?: string | true
  /** Keep writing to stdout as well while logging to `logFile` (a person watches the terminal). */
  teeStdout?: boolean
  /** Keep direct dependency/library console diagnostics out of an embedded host UI. */
  captureConsole?: boolean
  /**
   * Wire SIGINT/SIGTERM → graceful stop → `process.exit(0)`. True for the standalone
   * entry (it owns the process); false when a host embeds the server and drives the
   * lifecycle itself (it calls `stop()` on its own exit).
   */
  installSignalHandlers?: boolean
  /**
   * Treat `PORT` as a preference rather than a contract, and take an OS-assigned port if
   * it is already bound.
   *
   * Only the desktop shell may ask for this: its port comes from a reserve-and-release
   * probe, so it is a hint that can go stale in the gap before the bind. Everywhere else
   * `PORT` IS a contract — the dev Vite proxy points at it — and moving silently would
   * produce a running server nothing can reach.
   */
  portFallback?: boolean
  /**
   * The desktop shell that owns this runtime (`LOCALIX_DESKTOP_PARENT_PID`). Recorded in the
   * endpoint, and makes a runtime owned by ANOTHER live shell off limits (`runtime-shell-owner`).
   */
  shellPid?: number
}

/**
 * Boot the API in the CURRENT process and return a handle to it.
 *
 * This is the single boot path for every host: the standalone entry (below) and the
 * desktop Bun sidecar (bundled `server.js`, run as the entrypoint → `import.meta.main`).
 * An embedder may also `import()` this module and call `startServer` in-process rather
 * than spawning a detached child — a boot failure then surfaces inline instead of as a
 * silent "server exited (code 1)".
 *
 * A second host once booted its OWN API over the same SQLite file. Its startup migration
 * marked the desktop process's live run interrupted, then the real owner crashed at
 * finalization with "run is missing or already terminal". `acquireRuntimeOwnership`
 * refuses a duplicate LIVE owner before bootstrap/migrations touch shared persistence;
 * a dead/crashed owner (even one whose PID was recycled) is reclaimed automatically.
 */
export async function startServer(options: StartServerOptions = {}): Promise<EmbeddedServer> {
  const runtimeInstanceId = randomUUID()
  const runtimeStartedAt = new Date().toISOString()
  const requestedLogFile = options.logFile === true ? runtimeLogFile() : options.logFile
  const logDestination = requestedLogFile
    ? createRuntimeLogDestination(requestedLogFile)
    : undefined
  const restoreConsole =
    options.captureConsole && logDestination
      ? captureConsoleDiagnostics(createLogger('debug', logDestination))
      : undefined

  let runtimeOwnership: Awaited<ReturnType<typeof acquireRuntimeOwnership>>
  try {
    runtimeOwnership = await acquireRuntimeOwnership(runtimeInstanceId, resolveDbFile())
  } catch (error) {
    // The log destination is already open here, and this path used to close it without
    // ever writing to it — so the single most common startup failure left NO trace in
    // `localix-api.log` at all, and the shell could only report "timed out". The reason
    // goes to both channels: the file for a post-mortem, stderr for the live shell log.
    const reason = error instanceof Error ? error.message : String(error)
    startupDiag(`cannot take runtime ownership: ${reason}`)
    logDestination?.write(
      `${JSON.stringify({ level: 50, time: Date.now(), event: 'startup.failed', msg: reason })}\n`,
    )
    restoreConsole?.()
    await closeLogDestination(logDestination).catch(() => {})
    throw error
  }
  // Set at the first line of `stop()`: `/health` answers 503 from then on (see health.ts).
  let draining = false
  // Aborted by `stop()` so post-listen work still waiting on the login env never starts
  // subsystems that teardown has already passed.
  const postListen = new AbortController()
  const runtime = await (async () => {
    try {
      await assertNoLiveRuntimeEndpoint(runtimeOwnership.endpointFile, runtimeOwnership.databaseId)
      const defaultIdentity = await resolveRuntimeIdentity(defaultDbFile())
      if (defaultIdentity.databaseId === runtimeOwnership.databaseId) {
        await assertNoLiveRuntimeEndpoint(legacyRuntimeEndpointFile(), runtimeOwnership.databaseId)
      }
      return await bootstrap(undefined, {
        instanceId: runtimeInstanceId,
        startedAt: runtimeStartedAt,
        databaseId: runtimeOwnership.databaseId,
        logDestination,
        teeStdout: options.teeStdout,
        isDraining: () => draining,
      })
    } catch (error) {
      restoreConsole?.()
      const rollback = await Promise.allSettled([
        runtimeOwnership.release(),
        closeLogDestination(logDestination),
      ])
      const rollbackErrors = rollback
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          'API bootstrap failed and rollback was incomplete',
        )
      }
      throw error
    }
  })()

  let server: ReturnType<typeof Bun.serve> | undefined
  const publishedEndpointFiles: string[] = []
  let shutdownPromise: Promise<void> | undefined
  let uninstallSignalHandlers = (): void => {}
  // The graceful chain below kills every child we spawned — but only when it gets to RUN.
  // A fatal exit (uncaught throw, explicit process.exit, a failed startup) does not await
  // async handlers, and our children are detached into their own process groups so no
  // signal to us reaches them. This is the synchronous backstop for exactly that path.
  const uninstallOrphanGuard = installOrphanGuard()
  const stop = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise
    // Not attachable from this instant. A reopen right after quit used to find the
    // descriptor and a 200 `/health` for the whole teardown, attach, and be left talking
    // to a socket that closed a second later. So the drain is visible FIRST — `/health`
    // turns 503 and the descriptors go — and only then does anything slow begin.
    draining = true
    postListen.abort()
    shutdownPromise = (async () => {
      // The guarantee. Everything below is only the polite version of leaving.
      const deadline = armShutdownDeadline({
        ms: SHUTDOWN_DEADLINE_MS,
        onExpire: () => {
          startupDiag(`shutdown passed its ${SHUTDOWN_DEADLINE_MS}ms deadline; leaving anyway`)
          dropOwnershipArtifactsSync([runtimeOwnership.lockFile, ...publishedEndpointFiles])
        },
      })
      // A failed step is a warning, not a failed shutdown (`lib/shutdown-steps.ts`): the process
      // is leaving either way, and a non-zero exit reads as a crash the desktop shell restarts.
      const steps = createShutdownSteps(SHUTDOWN_STEP_MS, ({ step, error }) => {
        runtime.logger.warn({ event: 'shutdown.step_failed', step, err: error })
        startupDiag(`shutdown step ${step} did not finish cleanly: ${String(error)}`)
      })
      const cleanup = (label: string, operation: () => unknown, timeoutMs?: number) =>
        steps.run(label, operation, timeoutMs)

      for (const file of publishedEndpointFiles) {
        await cleanup('clearRuntimeEndpoint', () => clearRuntimeEndpoint(process.pid, file))
      }
      // Quiesce first. A boot reconcile still loading plugin backends, or a fact queued for the
      // inbox, used to finish after `db.destroy` and the log sink below: its write failed, the
      // failure log threw `SonicBoom destroyed`, and the process exited 1 after a clean quit.
      // Closing the journal here also means the jobs and terminals this teardown kills raise no
      // "stopped" rows — the person quit the app; that is not news.
      await cleanup('backendHost.stop', () => runtime.backendHost.stop())
      await cleanup('notifications.close', () => runtime.notifications.close())
      // Close every client connection next — the realtime WebSockets, streaming responses,
      // keep-alive sockets — so nothing a page still holds open can reach a subsystem this
      // teardown is about to stop. `stop(true)` drops the connections at once; its promise is
      // given a short budget of its own and is never what decides the exit code: a listener
      // that is slow to report closed must not use up the whole deadline.
      if (server) await cleanup('server.stop', () => server?.stop(true), SERVER_STOP_MS)
      // Stop accepting inbound platform messages before aborting runs, so no new
      // agent turn is spawned mid-teardown.
      await cleanup('channelHost.stop', () => runtime.channelHost.stop())
      // Stop plugin background monitors — kill their spawned child processes so they
      // don't orphan (mirrors channelHost teardown; both run before aborting runs).
      await cleanup('monitorHost.stop', () => runtime.monitorHost.stop())
      // Abort in-flight agent runs and kill tracked child processes (background
      // jobs, sub-agents) before tearing down the server — otherwise detached
      // process-group children survive the parent and orphan.
      await cleanup('chatService.shutdown', () => runtime.chatService.shutdown())
      // Abort interactive provider OAuth flows and release their deadline timers.
      await cleanup('providerConnections.dispose', () =>
        runtime.providerConnectionsService.dispose(),
      )
      // Stop editor-document diagnostics fan-out, then kill the language-server children.
      await cleanup('lspDocumentService.dispose', () => runtime.lspDocumentService.dispose())
      await cleanup('lspManager.dispose', () => runtime.lspManager.dispose())
      // Stop the semantic indexer and the embedding server child.
      await cleanup('semanticService.shutdown', () => runtime.semanticService.shutdown())
      await cleanup('localModels.shutdown', () => runtime.localModels.shutdown())
      // Kill every live PTY (interactive terminals + PTY-backed background jobs) —
      // otherwise the detached shell processes survive SIGINT/SIGTERM and orphan.
      await cleanup('terminalService.disposeAll', () => runtime.terminalService?.disposeAll())
      // Kill the agent's background monitors (watch processes + poll timers). Ordered after
      // the PTY sweep for the same reason: a monitor's child is detached, so nothing else in
      // this shutdown reaches it.
      await cleanup('monitorService.disposeAll', () => runtime.monitorService?.disposeAll())
      // Run each registered subsystem's cleanup hook (stateful ones kill their children).
      for (const s of runtime.subsystemRegistry.list()) {
        if (s.onShutdown) {
          await cleanup(`subsystem.${s.id}.onShutdown`, () => Promise.resolve(s.onShutdown?.()))
        }
      }
      // Stop the cached preview static + injecting-proxy servers so their ports are freed.
      await cleanup('disposePreviewServers', () => disposePreviewServers())
      // Release any held system controls (e.g. the keep-awake sleep inhibitor).
      await cleanup('systemService.stopAll', () => runtime.systemService.stopAll())
      // Ownership is released LAST on purpose, after the database handle is gone: a
      // second runtime that started while this one was still writing would run its
      // startup migration over a live run (see the note on `startServer`). The deadline
      // above — not an earlier release — is what bounds the wait for the next launch.
      await cleanup('db.destroy', () => runtime.db.destroy())
      await cleanup('ownership.release', () => runtimeOwnership.release())
      // The async kills above already reaped everything; drop the synchronous backstop so
      // an embedded restart does not accumulate handlers.
      await cleanup('uninstallOrphanGuard', () => uninstallOrphanGuard())
      // Released LAST, not first: with the handlers gone, a SIGTERM during the drain — the
      // successor reclaiming the lease sends one — took the default action and killed the
      // process mid-teardown. Installed, it joins this same shutdown. Released at all so an
      // embedded restart does not accumulate handlers pointing at a destroyed runtime.
      await cleanup('uninstallSignalHandlers', () => uninstallSignalHandlers())
      await cleanup('restoreConsole', () => restoreConsole?.())
      await cleanup('closeLogDestination', () => closeLogDestination(logDestination))
      deadline.disarm()
    })()
    return shutdownPromise
  }

  let port: number
  let baseUrl: string
  try {
    const listen = (port: number): ReturnType<typeof Bun.serve> =>
      Bun.serve({
        hostname: runtime.env.HOST,
        port,
        fetch: runtime.app.fetch,
        // Multiplexed realtime WebSocket (/rpc/ws) — all live client↔server traffic.
        // Bun auto-sends protocol pings to keep it alive; the attachment-sized
        // maxPayloadLength override lives on runtime.websocket (bootstrap.ts).
        websocket: runtime.websocket,
        // No idle timeout on long-lived connections (the realtime WebSocket; any
        // remaining long-poll). Bun's WebSocket pings keep /rpc/ws healthy regardless.
        idleTimeout: 0,
        // Stated, not inherited. Omitting this left the cap at Bun's default, which no code here
        // named and an upgrade could move — see `lib/request-limits.ts`. Bun checks it against
        // `Content-Length` BEFORE the handler runs, which is the only place a body limit can
        // actually bound memory.
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
      })
    try {
      server = listen(runtime.env.PORT)
    } catch (error) {
      if (!options.portFallback || runtime.env.PORT === 0 || !isAddressInUse(error)) throw error
      // The desktop shell reserves a port by binding :0 and CLOSING it, so between the
      // reservation and this bind the number is anybody's. Losing that race used to mean a
      // dead launch: the throw went through the whole rollback and the shell reported a
      // process that "exited (code 1)". The reserved port is a hint, not a contract — the
      // readiness frame carries whatever we actually got, and the shell's handoff script
      // already moves the page to it.
      startupDiag(`port ${runtime.env.PORT} was taken before we could bind; asking the OS`)
      server = listen(0)
    }
    // Not awaited: it waits on the user's login-shell env, which READY must not (see
    // bootstrap.ts). A subsystem that fails to start is logged rather than lost.
    void runtime.startPostListen(postListen.signal).catch((error: unknown) => {
      runtime.logger.error({ event: 'startup.post_listen_failed', err: error })
    })

    // With PORT=0 the OS assigns a free loopback port; publish/return the REAL one.
    port = server.port ?? runtime.env.PORT
    baseUrl = dialableRuntimeBaseUrl(runtime.env.HOST, port)
    const watch = envFlag('LOCALIX_RUNTIME_WATCH')
    if (watch) Object.assign(process.env, { PORT: String(port) })
    const endpoint: RuntimeEndpoint = {
      pid: process.pid,
      baseUrl,
      startedAt: runtimeStartedAt,
      protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      instanceId: runtimeInstanceId,
      databaseId: runtimeOwnership.databaseId,
      runtimeMode: watch ? 'development-watch' : 'daemon',
      listenHost: runtime.env.HOST,
      buildId: runtimeBuildId(),
      ...(options.shellPid ? { shellPid: options.shellPid } : {}),
    }
    await publishRuntimeEndpoint(endpoint, runtimeOwnership.endpointFile)
    publishedEndpointFiles.push(runtimeOwnership.endpointFile)

    const defaultIdentity = await resolveRuntimeIdentity(defaultDbFile())
    if (defaultIdentity.databaseId === runtimeOwnership.databaseId) {
      const legacyFile = legacyRuntimeEndpointFile()
      await publishRuntimeEndpoint(endpoint, legacyFile)
      publishedEndpointFiles.push(legacyFile)
    }
  } catch (startupError) {
    try {
      await stop()
    } catch (shutdownError) {
      throw new AggregateError(
        [startupError, shutdownError],
        'API startup failed and rollback was incomplete',
      )
    }
    throw startupError
  }

  runtime.logger.info({ event: 'server.started', host: runtime.env.HOST, port })
  // Listening first, warming second. The client's first capability read otherwise funds
  // plugin discovery (~1.2s on a packaged boot) and the activity rail fills in that late.
  runtime.warmStartupCaches()

  if (options.installSignalHandlers) {
    uninstallSignalHandlers = installServerSignalHandlers(stop)
  }

  return { baseUrl, port, stop }
}

const ENSURE_DAEMON_ARG = '--ensure-daemon'
const DAEMON_CHILD_ARG = '--runtime-daemon-child'
const WATCH_DAEMON_ARG = '--watch-daemon'

export interface ConnectedServer extends EmbeddedServer {
  /** False when this process attached to an already-running compatible runtime. */
  owned: boolean
}

export interface StartOrAttachServerOptions extends StartServerOptions {
  /**
   * Require an existing runtime to be reachable through this exact host before
   * attaching. Port-only clients need it — the packaged desktop webview is the only
   * caller today, and it pins `127.0.0.1`. Left unset, any reachable runtime qualifies,
   * which is the right default for a caller that uses the returned full baseUrl.
   */
  attachHost?: string
}

/**
 * May the desktop shell use this runtime instead of starting its own?
 *
 * The SAME build only, not merely the same protocol: after an update the relaunched shell
 * found the previous build's runtime still serving, matched it on protocol and attached, so
 * the new UI ran on old code until a reboot (`lib/runtime-build.ts`). A runtime older than
 * the build field has none and never matches. A mismatch is not attached to — the caller
 * stops it and takes over, the same path an incompatible protocol takes.
 */
function endpointCanAttach(
  endpoint: RuntimeEndpoint,
  options: StartOrAttachServerOptions,
): boolean {
  return (
    endpoint.protocolVersion === LOCALIX_API_PROTOCOL_VERSION &&
    isSameBuild(endpoint) &&
    (!options.attachHost || runtimeBaseUrlMatchesHost(endpoint.baseUrl, options.attachHost))
  )
}

/**
 * A desktop runtime never attaches to or stops a runtime that another LIVE desktop shell owns:
 * that is a second copy of the app on the same data folder, and taking its database started the
 * two copies replacing each other's runtime in a loop. The shell hands the user over instead.
 */
function refuseAnotherShellsRuntime(
  endpoint: RuntimeEndpoint,
  options: StartOrAttachServerOptions,
): void {
  if (options.shellPid === undefined) return
  const owner = owningShellPid(endpoint, options.shellPid)
  if (owner !== null) throw new RuntimeOwnedElsewhereError(owner, endpoint.baseUrl)
}

/**
 * How long to wait for an election winner to publish its endpoint.
 *
 * Deliberately far below the desktop shell's per-attempt budget: a wait that outlives the
 * supervisor is not patience, it is a guaranteed kill with no diagnostic. Sized for the
 * only legitimate case — a sibling that took the lease microseconds earlier and is still
 * booting.
 */
const ATTACH_WAIT_MS = RUNTIME_ATTACH_WAIT_MS

/**
 * Reuse a compatible runtime when one is already live, otherwise own the API in
 * the current process. Unlike `ensureDaemon`, this never creates a detached
 * grandchild, so an owning host (the desktop shell) can tie server lifetime to its own
 * process.
 */
export async function startOrAttachServer(
  options: StartOrAttachServerOptions = {},
): Promise<ConnectedServer> {
  const discovered = await discoverRuntimeEndpoint()
  const existing = isOwnDescriptor(discovered) ? null : discovered
  // Before attaching OR replacing: a runtime another live shell owns is that shell's.
  if (existing) refuseAnotherShellsRuntime(existing, options)
  if (existing && endpointCanAttach(existing, options)) {
    return {
      baseUrl: existing.baseUrl,
      port: endpointPort(existing)!,
      owned: false,
      stop: async () => {},
    }
  }
  if (existing) await stopRuntime(existing)

  try {
    const server = await startServer(options)
    return { ...server, owned: true }
  } catch (error) {
    if (!(error instanceof RuntimeOwnershipHeldError)) throw error
    // Someone else won the election and has not published its endpoint YET. That is the
    // only case worth waiting for, and it resolves in milliseconds — a holder that is
    // wedged rather than starting has already been dealt with by the reclaim inside
    // `acquireRuntimeOwnership`. The default 40s budget was written for neither: it
    // outlived the desktop shell's own patience, so the wait could not even finish
    // before the shell killed this process, and it printed nothing while it lasted.
    startupDiag(`${error.message}; waiting ${ATTACH_WAIT_MS}ms for it to publish an endpoint`)
    const endpoint = await waitForRuntimeEndpoint({
      protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      timeoutMs: ATTACH_WAIT_MS,
    })
    refuseAnotherShellsRuntime(endpoint, options)
    if (!endpointCanAttach(endpoint, options)) {
      throw new Error(
        `Localix API at ${endpoint.baseUrl} (build ${endpoint.buildId ?? 'unknown'}) cannot serve ` +
          `this build (${runtimeBuildId()}) through the required attach host ${options.attachHost}.`,
      )
    }
    return {
      baseUrl: endpoint.baseUrl,
      port: endpointPort(endpoint)!,
      owned: false,
      stop: async () => {},
    }
  }
}

async function runDesktopRuntime(): Promise<void> {
  const parentPid = Number(envString(RUNTIME_ENV.parentPid))
  const validParent = Number.isInteger(parentPid) && parentPid > 0 ? parentPid : undefined
  let server: ConnectedServer
  try {
    server = await startOrAttachServer({
      installSignalHandlers: true,
      logFile: runtimeLogFile(),
      // The native shell hands the webview a port, and the browser-side client
      // deliberately constructs 127.0.0.1:<port>. An IPv6-only runtime is valid for a
      // caller that consumes the full baseUrl, but cannot serve Desktop.
      attachHost: '127.0.0.1',
      // The shell's port is a reservation it already let go of; only here is that true.
      portFallback: true,
      shellPid: validParent,
    })
  } catch (error) {
    if (!(error instanceof RuntimeOwnedElsewhereError)) throw error
    // Not a failure to restart: another copy of the app owns this data folder. The shell
    // reads the frame and hands the user over to that copy (`sidecar.rs`).
    startupDiag(`${error.message}; leaving the data folder to it`)
    process.stdout.write(
      `${LOCALIX_RUNTIME_OWNED_ELSEWHERE_PREFIX}${JSON.stringify({
        shellPid: error.shellPid,
        baseUrl: error.baseUrl,
      })}\n`,
    )
    process.exit(RUNTIME_EXIT_OWNED_ELSEWHERE)
  }
  // Bounded like the attach wait, not by the 40 s default: the shell kills a start attempt
  // at 12 s (`READY_TIMEOUT_SECS`, sidecar.rs), so a longer wait could only end in that kill,
  // with no diagnostic. The endpoint is normally already published here.
  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- endpoint discovery is the readiness barrier for the server just started or attached above
  const endpoint = await waitForRuntimeEndpoint({
    protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
    timeoutMs: ATTACH_WAIT_MS,
  })
  process.stdout.write(`${LOCALIX_RUNTIME_READY_PREFIX}${JSON.stringify(endpoint)}\n`)

  // When Desktop owns the runtime, stdin is a tiny cross-platform graceful
  // shutdown channel and the parent watchdog prevents an orphan after a hard
  // shell crash. An attached one-shot process exits immediately after handoff.
  if (!server.owned) return
  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    // Exit 0 whatever the teardown reports: the shell asked for this stop, and a non-zero
    // code is what its supervisor reads as a crash to restart.
    await server.stop().catch((error) => console.warn('API shutdown incomplete', error))
    process.exit(0)
  }
  watchShutdownCommand(process.stdin, () => void stop())
  // The shell's pipe closing IS the shell dying — immune to the pid reuse that can blind
  // the watchdog below (lib/desktop-parent.ts). Only when stdin is that pipe.
  if (stdinIsParentPipe(currentStdinFacts(validParent))) {
    watchParentStdin(process.stdin, () => {
      startupDiag('desktop shell closed stdin; stopping')
      void stop()
    })
  }
  if (validParent) {
    const parentWatch = setInterval(() => {
      try {
        process.kill(parentPid, 0)
      } catch {
        clearInterval(parentWatch)
        void stop()
      }
    }, 1_000)
    parentWatch.unref()
  }
}

/** How long `--ensure-daemon` waits for a ready runtime before giving up. */
const ENSURE_DAEMON_TIMEOUT_MS = 40_000
/** Minimum gap between two spawn attempts while the first one is still starting. */
const ENSURE_DAEMON_RESPAWN_MS = 1_000
/** How often the descriptor is re-read while waiting. */
const ENSURE_DAEMON_POLL_MS = 100

export async function ensureDaemon(options: { watch?: boolean; host?: string } = {}) {
  const watch = options.watch === true
  const requestedHost = options.host?.trim()
  const host = requestedHost || '127.0.0.1'
  const deadline = Date.now() + ENSURE_DAEMON_TIMEOUT_MS
  let nextSpawnAt = 0
  const identity = await resolveRuntimeIdentity()
  let preferredPort = endpointPort(await readRuntimeEndpoint(identity.endpointFile)) ?? 0
  do {
    const found = await discoverRuntimeEndpoint()
    const existing = isOwnDescriptor(found) ? null : found
    if (existing) {
      const protocolMatches = existing.protocolVersion === LOCALIX_API_PROTOCOL_VERSION
      const watchMatches = !watch || existing.runtimeMode === 'development-watch'
      const hostMatches = !requestedHost || existing.listenHost === host
      if (protocolMatches && watchMatches && hostMatches) return existing
      preferredPort = endpointPort(existing) ?? preferredPort
      await stopRuntime(existing)
      nextSpawnAt = 0
      continue
    }

    const now = Date.now()
    if (now >= nextSpawnAt && !(await runtimeOwnershipIsHeld())) {
      await spawnDetachedDaemon(
        fileURLToPath(import.meta.url),
        DAEMON_CHILD_ARG,
        watch,
        host,
        preferredPort,
      )
      preferredPort = 0
      nextSpawnAt = now + ENSURE_DAEMON_RESPAWN_MS
    }
    await Bun.sleep(ENSURE_DAEMON_POLL_MS)
  } while (Date.now() < deadline)

  throw new Error(
    `Timed out after ${ENSURE_DAEMON_TIMEOUT_MS}ms waiting for the Localix API daemon to become ready.`,
  )
}

if (import.meta.main) {
  if (process.argv.includes(DESKTOP_RUNTIME_ARG)) {
    // The shell's first sign of life from this process. Without it, "printed nothing" could
    // mean anything; with it, silence means the runtime never got to run its own code — the
    // OS held the read of `server.js` (a macOS folder-access prompt nobody answered yet) — and
    // the shell says so instead of "timed out" (`sidecar.rs` `format_timeout_message`).
    startupDiag(`runtime code loaded pid=${process.pid}`)
    await runDesktopRuntime()
  } else if (process.argv.includes(ENSURE_DAEMON_ARG)) {
    const endpoint = await ensureDaemon({
      watch: process.argv.includes(WATCH_DAEMON_ARG),
      host: envString('LOCALIX_RUNTIME_HOST'),
    })
    process.stdout.write(`${LOCALIX_RUNTIME_READY_PREFIX}${JSON.stringify(endpoint)}\n`)
  } else {
    await restoreWatchPort()
    try {
      // The foreground entry (`bun run dev`) keeps its terminal output AND writes the shared
      // log, so a development launch is in `bun run logs` like a packaged one. A detached daemon
      // child must not: its stdout is already redirected INTO that file, and teeing would write
      // every line twice.
      const daemonChild = process.argv.includes(DAEMON_CHILD_ARG)
      await startServer({
        installSignalHandlers: true,
        ...(daemonChild ? {} : { logFile: true, teeStdout: true }),
      })
    } catch (error) {
      if (!(error instanceof RuntimeOwnershipHeldError)) throw error
      // A detached election loser exits immediately. The one-shot ensureDaemon
      // parent observes the lease and retries if the winner crashes before ready.
      if (process.argv.includes(DAEMON_CHILD_ARG)) process.exit(0)
      const endpoint = await waitForRuntimeEndpoint({
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      })
      if (!process.argv.includes(DAEMON_CHILD_ARG)) {
        process.stdout.write(`Localix API already running at ${endpoint.baseUrl}\n`)
      }
    }
  }
}

export type { App } from './app'

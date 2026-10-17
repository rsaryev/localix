import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { defaultDbFile, localixHome, resolveDbFile } from './env'
import {
  LOCALIX_API_PRODUCT_ID,
  type LocalixRuntimeInfo,
  type RuntimeReadyFrame,
} from './runtime-protocol'
import { startupDiag } from './startup-diagnostics'
import { awaitPidGone, processIsAlive } from './process-liveness'

export { dialableRuntimeBaseUrl } from './runtime-address'

/** Extends the frame the desktop shell parses, so a field it reads cannot be renamed away here. */
export interface RuntimeEndpoint extends RuntimeReadyFrame {
  startedAt: string
  protocolVersion: number
  instanceId?: string
  databaseId?: string
  runtimeMode?: 'daemon' | 'development-watch'
  listenHost?: string
  /** Which build is serving (`lib/runtime-build.ts`); absent from runtimes older than it. */
  buildId?: string
  /** The desktop shell that launched this runtime; absent outside the desktop app. */
  shellPid?: number
}

export interface RuntimeIdentity {
  databaseFile: string
  databaseId: string
  lockFile: string
  leaseFile: string
  endpointFile: string
}

interface RuntimeOwner {
  pid: number
  instanceId: string
  startToken: string | null
}

export class RuntimeOwnershipHeldError extends Error {
  constructor(
    readonly ownerPid: number | null,
    readonly databaseId: string,
  ) {
    super(
      ownerPid == null
        ? 'Localix API runtime ownership is held by another process'
        : `Localix API runtime ownership is held by pid ${ownerPid}`,
    )
    this.name = 'RuntimeOwnershipHeldError'
  }
}

function processStartToken(pid: number): string | null {
  if (process.platform === 'win32') return null
  try {
    return (
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).trim() || null
    )
  } catch {
    return null
  }
}

function ownerIsLive(owner: Partial<RuntimeOwner>): boolean {
  if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) return false
  if (!processIsAlive(owner.pid as number)) return false
  if (owner.startToken == null) return true
  const current = processStartToken(owner.pid as number)
  return current == null || current === owner.startToken
}

export async function resolveRuntimeIdentity(
  databaseFile = resolveDbFile(),
): Promise<RuntimeIdentity> {
  const absolute = resolve(databaseFile)
  await mkdir(dirname(absolute), { recursive: true })
  const canonical = await realpath(absolute).catch(async () =>
    join(await realpath(dirname(absolute)), basename(absolute)),
  )
  const databaseId = createHash('sha256').update(canonical).digest('hex').slice(0, 24)
  return {
    databaseFile: canonical,
    databaseId,
    lockFile: `${canonical}.api-owner`,
    leaseFile: `${canonical}.api-owner.sqlite`,
    endpointFile: `${canonical}.api-runtime.json`,
  }
}

async function publishOwnerAtomically(lockFile: string, owner: RuntimeOwner): Promise<boolean> {
  const candidate = `${lockFile}.candidate.${process.pid}.${randomUUID()}`
  const handle = await open(candidate, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(candidate, lockFile)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    await unlink(candidate).catch(() => {})
  }
}

async function quarantineStaleOwner(lockFile: string): Promise<boolean> {
  const quarantine = `${lockFile}.reclaim.${process.pid}.${randomUUID()}`
  try {
    await rename(lockFile, quarantine)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  let grabbed: Partial<RuntimeOwner> | null = null
  try {
    grabbed = JSON.parse(await readFile(quarantine, 'utf8')) as Partial<RuntimeOwner>
  } catch {}

  if (grabbed && ownerIsLive(grabbed)) {
    await link(quarantine, lockFile).catch(() => {})
    await unlink(quarantine).catch(() => {})
    return false
  }

  await unlink(quarantine).catch(() => {})
  return true
}

async function claimCompatibilityOwner(lockFile: string, owner: RuntimeOwner): Promise<void> {
  const deadline = Date.now() + 250
  for (;;) {
    if (await publishOwnerAtomically(lockFile, owner)) return

    let existing: Partial<RuntimeOwner>
    try {
      existing = JSON.parse(await readFile(lockFile, 'utf8')) as Partial<RuntimeOwner>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      if (Date.now() < deadline) {
        await Bun.sleep(10)
        continue
      }
      await quarantineStaleOwner(lockFile)
      continue
    }

    if (!Number.isInteger(existing.pid) || (existing.pid as number) <= 0) {
      if (Date.now() < deadline) {
        await Bun.sleep(10)
        continue
      }
      await quarantineStaleOwner(lockFile)
      continue
    }
    if (existing.pid === owner.pid) {
      await unlink(lockFile).catch(() => {})
      continue
    }
    if (ownerIsLive(existing)) {
      throw new RuntimeOwnershipHeldError(existing.pid as number, '')
    }
    await quarantineStaleOwner(lockFile)
  }
}

function releaseLease(lease: Database): void {
  try {
    if (lease.inTransaction) lease.exec('ROLLBACK')
  } finally {
    lease.close(false)
  }
}

/** Query the cross-process lease without consulting PID or endpoint metadata. */
export async function runtimeOwnershipIsHeld(databaseFile = resolveDbFile()): Promise<boolean> {
  const { leaseFile } = await resolveRuntimeIdentity(databaseFile)
  const lease = new Database(leaseFile, { create: true, strict: true })
  lease.exec('PRAGMA busy_timeout = 0')
  try {
    lease.exec('BEGIN EXCLUSIVE')
    releaseLease(lease)
    return false
  } catch (error) {
    lease.close(false)
    if ((error as { code?: string }).code === 'SQLITE_BUSY') return true
    throw error
  }
}

/**
 * Has THIS module realm already taken the lease? Reset by a `bun --watch` reload (which re-evaluates
 * the module graph in the same pid), which is exactly what distinguishes a reload — whose previous
 * realm is gone and unreachable — from a second acquisition inside one realm, which must still be
 * refused. See the same-process branch in {@link acquireRuntimeOwnership}.
 */
let realmTookLease = false

/**
 * Pretend this realm is brand new. ONLY for tests: in production the flag is cleared exclusively by a
 * `bun --watch` reload re-evaluating this module, and a test process cannot re-evaluate itself.
 */
export function resetRealmLeaseStateForTests(): void {
  realmTookLease = false
}

/**
 * How long a holder gets to honor SIGTERM before it is killed outright.
 *
 * Longer than the holder's own shutdown deadline (`SHUTDOWN_DEADLINE_MS`, 4 s, in
 * `index.ts`). A runtime that is DRAINING — quit a moment ago, descriptor already cleared,
 * `/health` answering 503 — looks exactly like a wedged one from here, and at 2 s it was
 * SIGKILLed halfway through teardown, orphaning the PTYs and dev servers that teardown was
 * about to reap. Its own deadline bounds it, so waiting past that costs a wedged holder
 * only the difference.
 */
const RECLAIM_TERM_GRACE_MS = 4_500

/** How long the kernel gets to reap a SIGKILLed holder before we call the reclaim failed. */
const RECLAIM_KILL_GRACE_MS = 500

/**
 * Take the lease from a holder that is alive but no longer SERVING.
 *
 * The lease answers "some process holds this file open", which is not the question. A
 * runtime whose teardown wedged after `server.stop()` — or one killed halfway through it —
 * is alive, answers nothing, and holds the lease for as long as it exists. Every later
 * launch then blocked on an endpoint that could never appear, and the only cure anyone
 * found was deleting `~/.localix`, which works solely because a recreated lease file gets
 * a new inode while the wedged holder keeps the old one.
 *
 * Killing a pid read off disk is only safe with proof that the pid still IS the process
 * that wrote it, so the start token is mandatory here: it is `ps -o lstart=`, so a
 * recycled pid — a stranger that inherited the number — never matches and is never
 * signalled. Without a token (Windows) we do not guess; the caller reports the conflict
 * instead. `stopRuntime` already does this for a holder that IS serving; this is the same
 * courtesy for one that is not.
 *
 * @returns true when the holder is gone and the lease is worth retrying.
 */
async function reclaimWedgedHolder(
  identity: RuntimeIdentity,
  owner: Partial<RuntimeOwner>,
): Promise<boolean> {
  const pid =
    Number.isInteger(owner.pid) && (owner.pid as number) > 0 ? (owner.pid as number) : null
  if (pid == null || pid === process.pid) return false
  if (!processIsAlive(pid)) return true

  // Same pid AND same incarnation of it. Anything less is not evidence.
  if (owner.startToken == null) {
    startupDiag(`ownership held by pid ${pid}, which cannot be attested on this platform`)
    return false
  }
  if (processStartToken(pid) !== owner.startToken) {
    startupDiag(`ownership lock names pid ${pid}, but that pid now belongs to another process`)
    return false
  }

  // Serving? Then it is a healthy owner and the caller must attach to it, not kill it.
  const endpoint = await readRuntimeEndpoint(identity.endpointFile)
  if (endpoint?.pid === pid && (await isRuntimeEndpointLive(endpoint))) return false

  startupDiag(`ownership held by pid ${pid}, which is not serving — reclaiming`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    startupDiag(`cannot signal pid ${pid}: ${String(error)}`)
    return false
  }
  if (await awaitPidGone(pid, RECLAIM_TERM_GRACE_MS)) {
    startupDiag(`pid ${pid} stopped; taking ownership`)
    return true
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
  const gone = await awaitPidGone(pid, RECLAIM_KILL_GRACE_MS)
  startupDiag(gone ? `pid ${pid} killed; taking ownership` : `pid ${pid} survived SIGKILL`)
  return gone
}

export async function acquireRuntimeOwnership(
  instanceId: string,
  databaseFile = resolveDbFile(),
): Promise<RuntimeIdentity & { release(): Promise<void> }> {
  const identity = await resolveRuntimeIdentity(databaseFile)
  let lease = new Database(identity.leaseFile, { create: true, strict: true })
  lease.exec('PRAGMA busy_timeout = 0')

  // Whether this run actually opened the lease transaction. A same-process watch reload (below)
  // legitimately proceeds without one, and must then not try to roll back what it never began.
  let holdsLease = true
  try {
    lease.exec('BEGIN EXCLUSIVE')
  } catch (error) {
    lease.close(false)
    if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error
    let owner: Partial<RuntimeOwner> = {}
    try {
      owner = JSON.parse(await readFile(identity.lockFile, 'utf8')) as Partial<RuntimeOwner>
    } catch {}
    const ownerPid =
      Number.isInteger(owner.pid) && (owner.pid as number) > 0 ? (owner.pid as number) : null

    // SAME-PROCESS RELOAD, not a foreign owner.
    //
    // `bun --watch` re-evaluates the module graph in the SAME pid (verified: the pid is identical
    // across reloads while `globalThis` is reset), so the previous run's `Database` handle is
    // unreachable from the new realm yet may still hold `BEGIN EXCLUSIVE`. The reloaded run then
    // failed here, `startOrAttachServer` waited 40s for an endpoint that could never appear (its own
    // descriptor pointed at the socket the old realm had closed), and the process — kept alive by
    // the watcher — sat owning the database and serving nothing. Every later start, including a
    // fresh `bun run dev`, hit the same wall, which is why the launcher never got past
    // "Waiting for your frontend dev server…". Observed with pid 99068 alive and holding no
    // listening socket.
    //
    // The lease exists for cross-PROCESS exclusion; a holder that IS this process is not that. The
    // start-token match keeps a recycled pid from a different process out. Proceeding is safe:
    // the port bind remains the mutual exclusion, so if the old realm's listener is somehow still up
    // this fails loudly on EADDRINUSE instead of stalling silently.
    const sameProcessReload =
      !realmTookLease &&
      ownerPid === process.pid &&
      (owner.startToken == null || owner.startToken === processStartToken(process.pid))
    if (sameProcessReload) {
      holdsLease = false
    } else {
      // A foreign holder. Attaching to a healthy one is the caller's job (it has the
      // endpoint); what must not happen here is waiting on a holder that will never
      // serve again — that wait is what turned one wedged teardown into an app that
      // could not be started until `~/.localix` was deleted.
      if (!(await reclaimWedgedHolder(identity, owner))) {
        throw new RuntimeOwnershipHeldError(ownerPid, identity.databaseId)
      }
      lease = new Database(identity.leaseFile, { create: true, strict: true })
      lease.exec('PRAGMA busy_timeout = 0')
      try {
        lease.exec('BEGIN EXCLUSIVE')
      } catch (retryError) {
        lease.close(false)
        // One retry only. A lease still busy after the holder is provably gone means
        // somebody else won the race, and racing them again is not this call's business.
        if ((retryError as { code?: string }).code !== 'SQLITE_BUSY') throw retryError
        throw new RuntimeOwnershipHeldError(null, identity.databaseId)
      }
    }
  }

  realmTookLease = true
  const owner: RuntimeOwner = {
    pid: process.pid,
    instanceId,
    startToken: processStartToken(process.pid),
  }

  try {
    await claimCompatibilityOwner(identity.lockFile, owner)
  } catch (error) {
    if (holdsLease) releaseLease(lease)
    if (error instanceof RuntimeOwnershipHeldError) {
      throw new RuntimeOwnershipHeldError(error.ownerPid, identity.databaseId)
    }
    throw error
  }

  let released = false
  return {
    ...identity,
    async release() {
      if (released) return
      released = true
      try {
        const current = JSON.parse(
          await readFile(identity.lockFile, 'utf8'),
        ) as Partial<RuntimeOwner>
        if (current.pid === process.pid && current.instanceId === instanceId) {
          await unlink(identity.lockFile).catch(() => {})
        }
      } catch {}
      // Only what this run opened: a same-process reload never began the transaction, and rolling
      // back the previous realm's lease through a closed handle would throw.
      if (holdsLease) releaseLease(lease)
    },
  }
}

export function legacyRuntimeEndpointFile(): string {
  return join(localixHome(), 'api-runtime.json')
}

function runtimeEndpointFile(databaseFile = resolveDbFile()): string {
  return `${resolve(databaseFile)}.api-runtime.json`
}

export async function readRuntimeEndpoint(
  file = runtimeEndpointFile(),
): Promise<RuntimeEndpoint | null> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<RuntimeEndpoint>
    if (
      !Number.isInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.baseUrl !== 'string' ||
      !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(value.baseUrl) ||
      typeof value.startedAt !== 'string' ||
      !Number.isInteger(value.protocolVersion) ||
      (value.instanceId !== undefined && typeof value.instanceId !== 'string') ||
      (value.databaseId !== undefined && typeof value.databaseId !== 'string') ||
      (value.runtimeMode !== undefined &&
        value.runtimeMode !== 'daemon' &&
        value.runtimeMode !== 'development-watch') ||
      (value.listenHost !== undefined &&
        (typeof value.listenHost !== 'string' || value.listenHost.length === 0)) ||
      (value.buildId !== undefined && typeof value.buildId !== 'string') ||
      (value.shellPid !== undefined &&
        (!Number.isInteger(value.shellPid) || (value.shellPid as number) <= 0))
    ) {
      return null
    }
    return value as RuntimeEndpoint
  } catch {
    return null
  }
}

export async function isRuntimeEndpointLive(endpoint: RuntimeEndpoint): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.baseUrl}/health`, {
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return false
    if (!endpoint.instanceId) return true
    const info = (await response.json()) as Partial<LocalixRuntimeInfo>
    return (
      info.productId === LOCALIX_API_PRODUCT_ID &&
      info.instanceId === endpoint.instanceId &&
      info.protocolVersion === endpoint.protocolVersion &&
      (!endpoint.databaseId ||
        endpoint.protocolVersion < 3 ||
        info.databaseId === endpoint.databaseId)
    )
  } catch {
    return false
  }
}

export interface DiscoverRuntimeEndpointOptions {
  databaseFile?: string
  file?: string
}

export async function discoverRuntimeEndpoint(
  options: DiscoverRuntimeEndpointOptions = {},
): Promise<RuntimeEndpoint | null> {
  const identity = await resolveRuntimeIdentity(options.databaseFile)
  let candidates: string[]
  if (options.file) {
    candidates = [options.file]
  } else {
    candidates = [identity.endpointFile]
    const defaultIdentity = await resolveRuntimeIdentity(defaultDbFile())
    if (defaultIdentity.databaseId === identity.databaseId) {
      candidates.push(legacyRuntimeEndpointFile())
    }
  }

  for (const file of new Set(candidates)) {
    const endpoint = await readRuntimeEndpoint(file)
    if (!endpoint) continue
    // Legacy descriptors have no databaseId and are candidates only for the
    // canonical default database (enforced while building candidates above).
    if (!options.file && endpoint.databaseId && endpoint.databaseId !== identity.databaseId)
      continue
    if (!processIsAlive(endpoint.pid)) continue
    if (await isRuntimeEndpointLive(endpoint)) return endpoint
  }
  return null
}

export interface WaitForRuntimeEndpointOptions extends DiscoverRuntimeEndpointOptions {
  timeoutMs?: number
  pollMs?: number
  protocolVersion?: number
}

export async function waitForRuntimeEndpoint(
  options: WaitForRuntimeEndpointOptions = {},
): Promise<RuntimeEndpoint> {
  const timeoutMs = options.timeoutMs ?? 40_000
  const pollMs = options.pollMs ?? 100
  const deadline = Date.now() + timeoutMs
  let incompatible: RuntimeEndpoint | null = null

  while (Date.now() <= deadline) {
    const endpoint = await discoverRuntimeEndpoint(options)
    if (endpoint) {
      if (
        options.protocolVersion !== undefined &&
        endpoint.protocolVersion !== options.protocolVersion
      ) {
        incompatible = endpoint
      } else {
        return endpoint
      }
    }
    await Bun.sleep(pollMs)
  }

  if (incompatible) {
    throw new Error(
      `The running Localix API uses protocol ${incompatible.protocolVersion}, but this client requires ${options.protocolVersion}.`,
    )
  }
  const identity = await resolveRuntimeIdentity(options.databaseFile)
  // Name what to look at. The old message gave only a database id, which told a user staring at
  // "Waiting for your frontend dev server…" nothing about where the runtime state lives or which
  // process is holding it.
  const stale = await readRuntimeEndpoint(identity.endpointFile)
  const holder = stale
    ? ` The descriptor at ${identity.endpointFile} claims ${stale.baseUrl} (pid ${stale.pid}${
        processIsAlive(stale.pid) ? ', alive but not answering' : ', no longer running'
      }).`
    : ` No descriptor at ${identity.endpointFile}.`
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for the Localix API runtime for database ${identity.databaseId}.${holder}`,
  )
}

export async function assertNoLiveRuntimeEndpoint(
  file = runtimeEndpointFile(),
  databaseId?: string,
): Promise<void> {
  const endpoint = await readRuntimeEndpoint(file)
  if (
    endpoint &&
    (!databaseId || !endpoint.databaseId || endpoint.databaseId === databaseId) &&
    processIsAlive(endpoint.pid) &&
    (await isRuntimeEndpointLive(endpoint))
  ) {
    throw new Error(
      `Localix API is already running at ${endpoint.baseUrl} (pid ${endpoint.pid}, protocol ${endpoint.protocolVersion})`,
    )
  }
}

export async function publishRuntimeEndpoint(
  endpoint: RuntimeEndpoint,
  file = runtimeEndpointFile(),
): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(endpoint)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

export async function clearRuntimeEndpoint(
  pid: number,
  file = runtimeEndpointFile(),
): Promise<void> {
  const endpoint = await readRuntimeEndpoint(file)
  if (endpoint?.pid !== pid) return
  await unlink(file).catch(() => {})
}

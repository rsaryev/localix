/**
 * One router per models folder, shared by every API process that uses the folder.
 *
 * The desktop app and a development server (`dev:web` isolates its database, not the models) can
 * run side by side over one `~/.localix/models`. Each used to start its own router, and each
 * start killed the other's as "stale" — mid-answer. Now the API that starts the router writes a
 * claim beside the presets: the router's pid, its own pid, the address and the key. Another API
 * that finds a claim whose owner and router are both alive, and whose router answers to the key,
 * uses that router instead of starting one. A claim whose owner is gone names a router nobody
 * stops any more, so it is reaped and replaced.
 *
 * The owner alone stops the router: on its idle timer, on quit, and — through the orphan guard —
 * when it dies. Every API records when it last used the router, so the owner's idle timer waits
 * while another API is still busy with it. An API using a router it does not own picks the
 * folder up again on its next request after the owner went away.
 *
 * Starts are serialized by a launch lock, so two APIs asking at the same moment start one router.
 * The claim holds the router's key, so it is written readable by this user only — the same user
 * who could read the key from either process's memory.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isAlive } from '../../lib/process-tree'
import { keyedRequest, type LlamaServer } from './llama-server'
import { reapServerPid } from './stale-server'

export interface RouterClaim {
  routerPid: number
  ownerPid: number
  baseUrl: string
  apiKey: string
}

/** What sharing the router needs from the machine; tests replace every part. */
export interface SharedRouterOs {
  /** This API process's pid, as the claim records the owner. */
  self: number
  isAlive(pid: number): boolean
  /** Kill a router nobody owns any more, only while its command line still names `marker`. */
  reap(pid: number, marker: string): Promise<boolean>
  /** Whether a claimed router answers to its key. */
  probe(claim: RouterClaim): Promise<boolean>
  now(): number
  /** Arm a timer; the result cancels it. */
  schedule(run: () => unknown, ms: number): () => void
  /** Wait between attempts at the launch lock. */
  pause(ms: number): Promise<void>
}

const PROBE_TIMEOUT_MS = 2_000
const LOCK_POLL_MS = 100

export const realSharedRouterOs: SharedRouterOs = {
  self: process.pid,
  isAlive,
  reap: reapServerPid,
  async probe(claim) {
    const ask = keyedRequest(claim.baseUrl, claim.apiKey)
    const answer = await ask('/models', { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch(
      () => null,
    )
    return answer?.ok ?? false
  },
  now: Date.now,
  schedule(run, ms) {
    const timer = setTimeout(run, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
  pause: (ms) => Bun.sleep(ms),
}

/** The files beside the presets that sharing uses. */
export function routerFiles(routerDir: string) {
  return {
    claim: path.join(routerDir, 'router.json'),
    lock: path.join(routerDir, 'launch.lock'),
    activity: path.join(routerDir, 'last-used'),
  }
}

const isPid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

export async function readClaim(file: string): Promise<RouterClaim | null> {
  const raw = await readFile(file, 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const claim = JSON.parse(raw) as Partial<RouterClaim>
    if (!isPid(claim.routerPid) || !isPid(claim.ownerPid)) return null
    if (typeof claim.baseUrl !== 'string' || typeof claim.apiKey !== 'string') return null
    return claim as RouterClaim
  } catch {
    return null
  }
}

/** Written whole or not at all, readable by this user only: it holds the router's key. */
export async function writeClaim(file: string, claim: RouterClaim): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(claim), { mode: 0o600 })
  await rename(temp, file)
}

/** Remove the claim only while it still names `ownerPid`: another API may have replaced it. */
export async function clearClaim(file: string, ownerPid: number): Promise<void> {
  if ((await readClaim(file))?.ownerPid === ownerPid) await rm(file, { force: true })
}

/**
 * Run `launch` holding the folder's launch lock. A lock whose holder is dead, or that has been
 * held past `timeoutMs` (a start never takes that long), is taken over. Two APIs taking over the
 * same dead lock at once can both get through; the cost is the old behaviour, a second router.
 */
export async function withLaunchLock<T>(
  file: string,
  os: SharedRouterOs,
  timeoutMs: number,
  launch: () => Promise<T>,
): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true })
  const deadline = os.now() + timeoutMs
  for (;;) {
    try {
      await writeFile(file, String(os.self), { flag: 'wx' })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const holder = Number.parseInt(await readFile(file, 'utf8').catch(() => ''), 10)
      const live = isPid(holder) && holder !== os.self && os.isAlive(holder)
      if (live && os.now() < deadline) await os.pause(LOCK_POLL_MS)
      else await rm(file, { force: true })
    }
  }
  try {
    return await launch()
  } finally {
    const holder = await readFile(file, 'utf8').catch(() => null)
    if (holder === String(os.self)) await rm(file, { force: true })
  }
}

/** When any API last used the folder's router, or null when none has recorded it. */
export async function lastUsed(file: string): Promise<number | null> {
  const at = Number.parseInt(await readFile(file, 'utf8').catch(() => ''), 10)
  return Number.isFinite(at) ? at : null
}

export async function recordUse(file: string, at: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, String(at))
}

/**
 * Another API's router, used under its claim. It runs while both it and its owner are alive: an
 * owner that died takes its router along (the orphan guard), and the next request starts anew.
 * Stopping it is the owner's business, so `stop` only lets go.
 */
export function borrowedServer(
  claim: RouterClaim,
  os: Pick<SharedRouterOs, 'isAlive'>,
): LlamaServer {
  return {
    pid: claim.routerPid,
    baseUrl: claim.baseUrl,
    apiKey: claim.apiKey,
    get running() {
      return os.isAlive(claim.routerPid) && os.isAlive(claim.ownerPid)
    },
    request: keyedRequest(claim.baseUrl, claim.apiKey),
    async stop() {},
  }
}

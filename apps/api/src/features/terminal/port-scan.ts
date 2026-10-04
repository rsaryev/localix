/**
 * OS-level listening-port enumeration — the GROUND TRUTH for "what is this dev
 * server actually serving", used when a process prints no banner (so the
 * content-based {@link import('../agent-core/tools/preview/served-url-detect')}
 * scanner finds nothing) and to cross-validate a banner against a real listener.
 *
 * This is the ONLY OS-specific code in the preview path — it lives in the terminal
 * FEATURE (not the agnostic agent-core) because it shells out to `lsof` / reads
 * `/proc`. The pure parsers + attribution are exported for unit tests; the platform
 * scan is best-effort and returns `[]` on any unsupported OS or failure.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, readlink } from 'node:fs/promises'

import { isPathWithin } from '../../lib/path-containment'

const exec = promisify(execFile)

/** A process listening on a local TCP port, with the cwd it runs in when known. */
export interface ListeningPort {
  port: number
  pid: number
  /** Absolute working directory of the listening process (for session attribution). */
  cwd?: string
}

const SCAN_TIMEOUT_MS = 3_000

/**
 * Enumerate processes listening on local TCP ports. macOS uses `lsof`, Linux reads
 * `/proc`. Any other platform (or a failure/timeout) yields an empty list — the
 * caller treats "no scan" as "no extra info", never an error.
 */
export async function scanListeningPorts(): Promise<ListeningPort[]> {
  try {
    if (process.platform === 'darwin') return await scanDarwin()
    if (process.platform === 'linux') return await scanLinux()
  } catch {
    // best-effort — a missing tool / permission / timeout just means no scan
  }
  return []
}

/** True when `child` is the same path as `base` or nested under it — used to attribute
 *  a listener (by its cwd) to a session's workspace. The containment rule itself has one
 *  owner (`lib/path-containment.ts`); this keeps the caller's `(child, base)` reading. */
export function isSameOrDescendant(child: string, base: string): boolean {
  return isPathWithin(base, child)
}

// ── macOS (lsof) ─────────────────────────────────────────────────────────────

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -F pcn` field output into {pid, port}. The
 *  `-F pcn` format emits one field per line: `p<pid>`, `c<command>`, `n<host:port>`
 *  — a `p` line starts a new process, its `n` lines are that process's listeners. */
export function parseLsofListeners(stdout: string): Array<{ pid: number; port: number }> {
  const out: Array<{ pid: number; port: number }> = []
  let pid = 0
  for (const line of stdout.split('\n')) {
    const tag = line[0]
    const rest = line.slice(1)
    if (tag === 'p') pid = Number.parseInt(rest, 10) || 0
    else if (tag === 'n' && pid) {
      const port = portFromAddress(rest)
      if (port) out.push({ pid, port })
    }
  }
  return out
}

/** Parse `lsof -a -p <pids> -d cwd -Fn` into pid → cwd. */
export function parseLsofCwds(stdout: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid = 0
  for (const line of stdout.split('\n')) {
    const tag = line[0]
    const rest = line.slice(1)
    if (tag === 'p') pid = Number.parseInt(rest, 10) || 0
    else if (tag === 'n' && pid && rest) map.set(pid, rest)
  }
  return map
}

/** Port from an lsof address field: `*:5173`, `127.0.0.1:5173`, `[::1]:5173`. */
function portFromAddress(addr: string): number {
  const colon = addr.lastIndexOf(':')
  if (colon < 0) return 0
  const port = Number.parseInt(addr.slice(colon + 1), 10)
  return Number.isFinite(port) && port > 0 ? port : 0
}

async function scanDarwin(): Promise<ListeningPort[]> {
  const { stdout } = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
    timeout: SCAN_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  const listeners = parseLsofListeners(stdout)
  if (listeners.length === 0) return []
  const pids = [...new Set(listeners.map((l) => l.pid))]
  let cwds = new Map<number, string>()
  try {
    const r = await exec('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'], {
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    cwds = parseLsofCwds(r.stdout)
  } catch {
    // cwd lookup is optional — without it the listener just won't attribute
  }
  return listeners.map((l) => ({ port: l.port, pid: l.pid, cwd: cwds.get(l.pid) }))
}

// ── Linux (/proc) ──────────────────────────────────────────────────────────--

/** Parse a `/proc/net/tcp(6)` table → listening sockets (state 0A) with their
 *  inode. The local address is `HEXIP:HEXPORT`; we only need the port + inode. */
export function parseProcNetTcp(content: string): Array<{ port: number; inode: number }> {
  const out: Array<{ port: number; inode: number }> = []
  const lines = content.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(/\s+/)
    if (cols.length < 10) continue
    if (cols[3] !== '0A') continue // 0A = TCP_LISTEN
    const local = cols[1]
    const portHex = local.slice(local.lastIndexOf(':') + 1)
    const port = Number.parseInt(portHex, 16)
    const inode = Number.parseInt(cols[9], 10)
    if (port > 0 && Number.isFinite(inode)) out.push({ port, inode })
  }
  return out
}

async function scanLinux(): Promise<ListeningPort[]> {
  const tables = await Promise.all([
    readFile('/proc/net/tcp', 'utf8').catch(() => ''),
    readFile('/proc/net/tcp6', 'utf8').catch(() => ''),
  ])
  const sockets = tables.flatMap(parseProcNetTcp)
  if (sockets.length === 0) return []
  const wantedInodes = new Set(sockets.map((s) => s.inode))
  const inodeToPid = await mapInodesToPids(wantedInodes)
  const listenerPids = [
    ...new Set(
      sockets.map((s) => inodeToPid.get(s.inode)).filter((pid): pid is number => Boolean(pid)),
    ),
  ]
  const cwds = await Promise.all(
    listenerPids.map((pid) => readlink(`/proc/${pid}/cwd`).catch(() => undefined)),
  )
  const cwdCache = new Map(listenerPids.map((pid, i) => [pid, cwds[i]] as const))
  const out: ListeningPort[] = []
  for (const s of sockets) {
    const pid = inodeToPid.get(s.inode)
    if (!pid) continue
    out.push({ port: s.port, pid, cwd: cwdCache.get(pid) })
  }
  return out
}

/** How many `/proc/<pid>/fd` walks run at once. Each is an independent read of a
 *  different process's fd table; the cap keeps a 1000-process host from queueing
 *  every walk into the fs threadpool at once. */
const FD_WALK_CONCURRENCY = 16

/** Every wanted socket inode a single process holds open, in fd order. */
async function socketInodesOf(pidStr: string, inodes: Set<number>): Promise<number[]> {
  const held: number[] = []
  const fds = await readdir(`/proc/${pidStr}/fd`).catch(() => [])
  for (const fd of fds) {
    const target = await readlink(`/proc/${pidStr}/fd/${fd}`).catch(() => '')
    const m = target.match(/^socket:\[(\d+)\]$/)
    if (m) {
      const inode = Number(m[1])
      if (inodes.has(inode)) held.push(inode)
    }
  }
  return held
}

/** Walk `/proc/<pid>/fd/*` symlinks for `socket:[inode]` entries to map a listening
 *  socket inode back to its owning PID. Walks run `FD_WALK_CONCURRENCY` at a time and
 *  stop pulling new pids once every wanted inode is accounted for; the map is then
 *  assembled in `/proc` order, so an inode held by several processes (a forked child
 *  inherits the listening fd) still resolves to the same pid a serial walk would pick. */
async function mapInodesToPids(inodes: Set<number>): Promise<Map<number, number>> {
  const pids = (await readdir('/proc').catch(() => [])).filter((n) => /^\d+$/.test(n))
  const held = Array.from<number[] | undefined>({ length: pids.length })
  const found = new Set<number>()
  let next = 0
  const workers = Array.from({ length: Math.min(FD_WALK_CONCURRENCY, pids.length) }, async () => {
    while (found.size < inodes.size) {
      const i = next++
      if (i >= pids.length) return
      const sockets = await socketInodesOf(pids[i], inodes)
      held[i] = sockets
      for (const inode of sockets) found.add(inode)
    }
  })
  await Promise.all(workers)

  const map = new Map<number, number>()
  for (let i = 0; i < pids.length; i++) {
    for (const inode of held[i] ?? []) {
      if (!map.has(inode)) map.set(inode, Number(pids[i]))
    }
  }
  return map
}

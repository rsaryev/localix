/**
 * One managed `llama-server` process: spawned, health-checked, stopped. What it serves is the
 * caller's choice (`args`); the local-models router starts it in router mode over its presets.
 *
 * It listens on loopback only, on a port picked at start, and requires a per-start random API
 * key — a page in the browser cannot reach it, and another local process would need our memory
 * to use it. Its pid is tracked by the orphan guard, so a fatal API exit still SIGKILLs it.
 */
import { randomBytes } from 'node:crypto'
import { killProcessTree } from '../../lib/process-tree'
import { trackSpawnedProcess } from '../../lib/orphan-guard'

export interface LlamaServer {
  readonly pid: number
  readonly baseUrl: string
  readonly apiKey: string
  readonly running: boolean
  /** `fetch` against the server with its key. */
  request(pathname: string, init?: RequestInit): Promise<Response>
  stop(): Promise<void>
}

export interface LlamaServerOptions {
  executable: string
  /** Everything after the executable; the port and key are the ones this start picked. */
  args(port: number, apiKey: string): string[]
  cwd?: string
  startTimeoutMs?: number
  /** Called with the last stderr lines when the process exits on its own. */
  onExit?(info: { code: number | null; stderrTail: string }): void
}

const DEFAULT_START_TIMEOUT_MS = 60_000
const STDERR_TAIL_LINES = 30
const KILL_GRACE_MS = 2000

/** System packages that provide a library the CPU builds load (Debian/Ubuntu names). */
const LIBRARY_PACKAGES: Record<string, string> = { 'libgomp.so.1': 'libgomp1' }

/**
 * A start failure in words a person can act on. The Linux CPU build needs the OpenMP runtime
 * (`libgomp.so.1`), which minimal installs lack: measured on `ubuntu:24.04`, where it exits at
 * load with nothing but the loader's message.
 */
export function explainStartFailure(code: number | null, stderr: string): string {
  const missing = /error while loading shared libraries: (\S+?):/.exec(stderr)?.[1]
  if (missing) {
    const pkg = LIBRARY_PACKAGES[missing]
    return `The local model runtime needs the system library ${missing}${pkg ? ` — install the ${pkg} package` : ''}.`
  }
  return `llama-server exited during start (${code}): ${stderr.split('\n').slice(-5).join(' ')}`
}

/** A request to a llama-server at `baseUrl`, carrying the key it was started with. */
export function keyedRequest(baseUrl: string, apiKey: string) {
  return (pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${apiKey}`)
    return fetch(`${baseUrl}${pathname}`, { ...init, headers })
  }
}

async function freeLoopbackPort(): Promise<number> {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

export async function startLlamaServer(options: LlamaServerOptions): Promise<LlamaServer> {
  const port = await freeLoopbackPort()
  const apiKey = randomBytes(24).toString('hex')
  const child = Bun.spawn([options.executable, ...options.args(port, apiKey)], {
    cwd: options.cwd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    // Its own process group, so the group kill reaches the model instances it forks.
    detached: true,
    windowsHide: true,
  })
  const untrack = trackSpawnedProcess(child.pid)
  const stderrLines: string[] = []
  let stoppedOnPurpose = false
  // Not `child.exitCode`: a process ended by a signal has a null exit code.
  let exited = false

  void (async () => {
    const decoder = new TextDecoder()
    let carry = ''
    for await (const chunk of child.stderr as unknown as AsyncIterable<Uint8Array>) {
      const lines = (carry + decoder.decode(chunk, { stream: true })).split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) {
        stderrLines.push(line)
        if (stderrLines.length > STDERR_TAIL_LINES) stderrLines.shift()
      }
    }
  })().catch(() => {})

  void child.exited.then((code) => {
    exited = true
    untrack()
    if (!stoppedOnPurpose) options.onExit?.({ code, stderrTail: stderrLines.join('\n') })
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + (options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)
  for (;;) {
    if (exited) {
      throw new Error(explainStartFailure(child.exitCode, stderrLines.join('\n')))
    }
    const ok = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.status === 200)
      .catch(() => false)
    if (ok) break
    if (Date.now() > deadline) {
      stoppedOnPurpose = true
      killProcessTree(child.pid, KILL_GRACE_MS, () => !exited)
      throw new Error('llama-server did not become ready in time')
    }
    await Bun.sleep(150)
  }

  return {
    pid: child.pid,
    baseUrl,
    apiKey,
    get running() {
      return !exited
    },
    request: keyedRequest(baseUrl, apiKey),
    async stop() {
      if (exited) return
      stoppedOnPurpose = true
      killProcessTree(child.pid, KILL_GRACE_MS, () => !exited)
      await Promise.race([child.exited, Bun.sleep(3000)])
    },
  }
}

import { randomUUID } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { shellQuote } from '@localixai/mini-app-sdk/backend'
import { createKubeConfig } from './api-internals'
import { createBunApiClient } from './api-http'
import { createBunWebSocketHandler } from './api-websocket'
import { mapKubeError } from './errors'
import { getKubernetesClient } from './kubernetes-client'

export interface ExecTarget {
  namespace: string
  pod: string
  context?: string
  container?: string
}

interface ExecSession extends ExecTarget {
  token: string
  expires: ReturnType<typeof setTimeout>
  input?: PassThrough
  remote?: { close(): void }
  local?: Bun.ServerWebSocket<{ token: string }>
}

const RELAY_SOURCE =
  "const ws=new WebSocket(process.argv[1]);ws.binaryType='arraybuffer';ws.onopen=()=>{process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.on('data',d=>ws.send(d))};ws.onmessage=e=>process.stdout.write(Buffer.from(e.data));ws.onerror=e=>process.stderr.write(`\\r\\n${e.message||'Exec connection failed'}\\r\\n`);ws.onclose=e=>{process.stdin.setRawMode?.(false);process.exit(e.code===1000?0:1)}"

/** The remote end of a pod exec: what `k8s.Exec#exec` resolves to, as far as this file uses it. */
interface RemoteExec {
  close(): void
  addEventListener(type: 'close', listener: () => void, options: { once: true }): void
}

/** The two cluster calls a session makes — a seam so the setup race can be tested without one. */
export interface ExecDeps {
  verifyPod(target: ExecTarget): Promise<void>
  connect(
    session: ExecTarget,
    output: Writable,
    input: PassThrough,
    onFailure: (message: string) => void,
  ): Promise<RemoteExec>
}

const clusterExecDeps: ExecDeps = {
  async verifyPod(target) {
    const k8s = await getKubernetesClient()
    const config = await createKubeConfig(target.context)
    try {
      const core = await createBunApiClient(config, k8s.CoreV1Api)
      await core.readNamespacedPod({ name: target.pod, namespace: target.namespace })
    } catch (error) {
      throw mapKubeError(error)
    }
  },
  async connect(session, output, input, onFailure) {
    const k8s = await getKubernetesClient()
    const config = await createKubeConfig(session.context)
    const exec = new k8s.Exec(config, createBunWebSocketHandler(config))
    const shellCommand = buildPodShellCommand({
      ...session,
      context: session.context || config.getCurrentContext(),
    })
    return exec.exec(
      session.namespace,
      session.pod,
      session.container ?? '',
      ['sh', '-c', shellCommand],
      output,
      output,
      input,
      true,
      (status) => {
        if (status.status === 'Failure' && status.message) onFailure(status.message)
      },
    )
  },
}

/**
 * The command the host terminal runs to relay a pod shell over the local websocket.
 *
 * It names the RUNNING runtime (`process.execPath`), not `bun`: the packaged app ships Bun as a
 * sidecar that is not on the terminal's PATH, so a bare `bun -e` failed with "command not found"
 * on every pod Exec for anyone without their own Bun install.
 */
export function buildRelayCommand(url: string, runtime: string = process.execPath): string {
  return `${shellQuote(runtime)} -e ${shellQuote(RELAY_SOURCE)} -- ${shellQuote(url)}`
}

function promptPart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._/-]/g, '?').slice(0, 96)
}

/** Build the non-invasive shell profile used by pod exec sessions.
 *
 * Nothing is written into the container: the 256-color capability, identity banner,
 * and prompt live only for this one process. Bash gets a cwd-aware prompt; minimal
 * images still receive a compact POSIX-sh prompt.
 */
export function buildPodShellCommand(target: ExecTarget): string {
  const location = `${promptPart(target.namespace)}/${promptPart(target.pod)}`
  const identity = [
    target.context ? promptPart(target.context) : '',
    location,
    target.container ? promptPart(target.container) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const bashPrompt =
    '\\[\\e[38;5;45m\\]⎈\\[\\e[0m\\] ' +
    `\\[\\e[1m\\]${identity}\\[\\e[0m\\] ` +
    '\\[\\e[38;5;111m\\]\\w\\[\\e[0m\\] ' +
    '\\[\\e[38;5;114m\\]\\$\\[\\e[0m\\] '
  const escape = '\u001b'
  const shPrompt =
    `${escape}[38;5;45m⎈${escape}[0m ` +
    `${escape}[1m${identity}${escape}[0m ` +
    `${escape}[38;5;114m$${escape}[0m `

  return [
    'export TERM="${TERM:-xterm-256color}"',
    'export COLORTERM="${COLORTERM:-truecolor}"',
    'export CLICOLOR=1',
    `printf '\\033[2mKubernetes\\033[0m  \\033[1;36m%s\\033[0m\\r\\n' ${shellQuote(identity)}`,
    `if command -v bash >/dev/null 2>&1; then export PS1=${shellQuote(bashPrompt)}; exec bash --noprofile --norc -i; fi`,
    `export PS1=${shellQuote(shPrompt)}`,
    'exec sh -i',
  ].join('; ')
}

/**
 * One-time loopback websocket bridge between the existing Localix PTY tab and the
 * Kubernetes pods/exec websocket. The terminal command contains no kube credentials;
 * only an unguessable, single-use local token.
 */
export class ApiExecRegistry {
  private readonly sessions = new Map<string, ExecSession>()
  private server: Bun.Server<{ token: string }> | null = null

  private ensureServer(): Bun.Server<{ token: string }> {
    if (this.server) return this.server
    this.server = Bun.serve<{ token: string }>({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) => {
        const token = new URL(request.url).pathname.slice(1)
        const session = this.sessions.get(token)
        if (!session || session.local)
          return new Response('Exec session not found', { status: 404 })
        if (server.upgrade(request, { data: { token } })) return
        return new Response('WebSocket upgrade failed', { status: 400 })
      },
      websocket: {
        open: (socket) => void this.open(socket),
        message: (socket, message) => {
          const session = this.sessions.get(socket.data.token)
          if (!session?.input) return
          session.input.write(typeof message === 'string' ? message : Buffer.from(message))
        },
        close: (socket) => this.close(socket.data.token),
      },
    })
    return this.server
  }

  constructor(private readonly deps: ExecDeps = clusterExecDeps) {}

  async command(target: ExecTarget): Promise<string> {
    await this.deps.verifyPod(target)
    const token = randomUUID()
    const expires = setTimeout(() => this.close(token), 30_000)
    this.sessions.set(token, { ...target, token, expires })
    const server = this.ensureServer()
    const url = `ws://127.0.0.1:${server.port}/${token}`
    return buildRelayCommand(url)
  }

  private async open(local: Bun.ServerWebSocket<{ token: string }>): Promise<void> {
    const session = this.sessions.get(local.data.token)
    if (!session) return local.close(1008, 'Exec session expired')
    clearTimeout(session.expires)
    session.local = local
    session.input = new PassThrough()
    const output = new Writable({
      write(chunk, _encoding, done) {
        if (local.readyState === WebSocket.OPEN) local.send(chunk)
        done()
      },
    })
    try {
      const remote = await this.deps.connect(session, output, session.input, (message) =>
        local.send(`\r\n${message}\r\n`),
      )
      // The terminal can close while `exec.exec` is still connecting: `close(token)` has then
      // already dropped this session, and parking the remote on the orphan leaked the websocket
      // and the shell in the pod. A session that is no longer registered closes what it got.
      if (this.sessions.get(session.token) !== session) {
        remote.close()
        return
      }
      session.remote = remote
      remote.addEventListener(
        'close',
        () => {
          if (local.readyState === WebSocket.OPEN) local.close(1000)
        },
        { once: true },
      )
    } catch (error) {
      const mapped = mapKubeError(error)
      if (local.readyState === WebSocket.OPEN) {
        // The terminal is the only surface here: the sentence first, the cluster's own words
        // after it — never the raw text alone.
        const raw = mapped.message === mapped.friendly ? '' : `\r\n${mapped.message}`
        local.send(`\r\n${mapped.friendly}${raw}\r\n`)
        local.close(1011, 'Kubernetes exec failed')
      }
    }
  }

  private close(token: string): void {
    const session = this.sessions.get(token)
    if (!session) return
    this.sessions.delete(token)
    clearTimeout(session.expires)
    session.input?.end()
    session.remote?.close()
  }

  async stopAll(): Promise<void> {
    for (const token of this.sessions.keys()) this.close(token)
    await this.server?.stop(true)
    this.server = null
  }
}

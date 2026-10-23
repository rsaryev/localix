import { KILL_ESCALATION_MS, toolEnv } from '@localixai/mini-app-sdk/backend'
import type { DockerEventsFrame, DockerEventsStatus, DockerEventType } from './events-contract'

/**
 * ONE `docker events` child for every open Docker surface, while at least one is open.
 *
 * Each realtime socket refcounts its own subscriptions, but two windows (or the sidebar and a
 * container tab on two sockets) would each spawn a child of their own; the hub is the process-wide
 * refcount, so the daemon carries one events stream however many surfaces watch it. The last
 * unsubscribe kills the child — SIGTERM, then SIGKILL if it has not exited after
 * `KILL_ESCALATION_MS` — so a closed panel never leaves a `docker events` running.
 *
 * `live` is announced only once the child has stayed up for `liveAfterMs`: with the daemon down,
 * `docker events` exits at once, and calling every short-lived attempt live would switch the UI
 * to its slow backstop cadence exactly while the stream delivers nothing. A child that exits while
 * someone still watches is restarted with a capped backoff; the UI polls fast meanwhile.
 */

export interface DockerEventsChild {
  readonly stdout: ReadableStream<Uint8Array>
  readonly exited: Promise<unknown>
  kill(signal?: NodeJS.Signals | number): void
}

export type SpawnDockerEvents = () => DockerEventsChild

const STREAMED_TYPES: readonly DockerEventType[] = ['container', 'image', 'volume', 'network']

export const DOCKER_EVENTS_COMMAND = [
  'docker',
  'events',
  '--format',
  '{{json .}}',
  ...STREAMED_TYPES.flatMap((type) => ['--filter', `type=${type}`]),
]

const defaultSpawn: SpawnDockerEvents = () =>
  // `env` for the same reason as the CLI backend: without it Bun resolves `docker` on the PATH the
  // process started with, and the packaged app's stream sat in `down`, retrying forever.
  Bun.spawn(DOCKER_EVENTS_COMMAND, {
    stdout: 'pipe',
    stderr: 'ignore',
    stdin: 'ignore',
    env: toolEnv(),
  })

/**
 * Actions that change nothing the inventory shows. A container with a health check runs an exec
 * per probe — `exec_create`, `exec_start`, `exec_die` every interval — and refreshing on each
 * would turn the event stream back into a poll driven by somebody else's timer.
 */
const QUIET_ACTION =
  /^(?:exec_|attach$|detach$|resize$|top$|archive-path$|extract-to-dir$|export$|copy$)/u

/** One line of `docker events --format '{{json .}}'` as a frame, or null when it changes nothing. */
export function parseDockerEvent(line: string): DockerEventsFrame | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const event = raw as { Type?: unknown; Action?: unknown; Actor?: { ID?: unknown }; id?: unknown }
  const type = STREAMED_TYPES.find((candidate) => candidate === event.Type)
  if (!type || typeof event.Action !== 'string' || QUIET_ACTION.test(event.Action)) return null
  const id =
    typeof event.Actor?.ID === 'string'
      ? event.Actor.ID
      : typeof event.id === 'string'
        ? event.id
        : ''
  return { kind: 'event', type, action: event.Action, id }
}

export function eventsRestartDelay(attempt: number): number {
  return Math.min(1_500 * 2 ** Math.max(0, attempt), 30_000)
}

export interface DockerEventsHub {
  /** Follow the stream; the listener hears the current status at once. Returns the unfollow. */
  subscribe(listener: (frame: DockerEventsFrame) => void): () => void
  /** Mini app shutdown: drop every listener and stop the child. */
  stopAll(): void
}

export function createDockerEventsHub(
  options: {
    spawn?: SpawnDockerEvents
    liveAfterMs?: number
    restartDelay?: (attempt: number) => number
  } = {},
): DockerEventsHub {
  const spawn = options.spawn ?? defaultSpawn
  const liveAfterMs = options.liveAfterMs ?? 1_000
  const restartDelay = options.restartDelay ?? eventsRestartDelay
  const listeners = new Set<(frame: DockerEventsFrame) => void>()
  let status: DockerEventsStatus = 'down'
  let child: DockerEventsChild | null = null
  let generation = 0
  let attempt = 0
  let liveTimer: ReturnType<typeof setTimeout> | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const broadcast = (frame: DockerEventsFrame) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(frame)
      } catch {
        /* one socket's failure must not stop the others' frames */
      }
    }
  }
  const setStatus = (next: DockerEventsStatus) => {
    if (status === next) return
    status = next
    broadcast({ kind: 'status', status })
  }
  const clearTimers = () => {
    if (liveTimer) clearTimeout(liveTimer)
    if (restartTimer) clearTimeout(restartTimer)
    liveTimer = null
    restartTimer = null
  }

  const scheduleRestart = () => {
    if (listeners.size === 0 || restartTimer) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      start()
    }, restartDelay(attempt++))
    restartTimer.unref?.()
  }

  const pump = async (owner: DockerEventsChild, gen: number) => {
    const decoder = new TextDecoder()
    let pending = ''
    try {
      for await (const chunk of owner.stdout) {
        if (gen !== generation) return
        pending += decoder.decode(chunk, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const frame = line.trim() ? parseDockerEvent(line) : null
          if (frame) broadcast(frame)
        }
      }
    } catch {
      /* the child was killed mid-read; `exited` reports it */
    }
  }

  const start = () => {
    const gen = ++generation
    let next: DockerEventsChild
    try {
      next = spawn()
    } catch {
      // No `docker` on PATH: the UI's poll stays in charge; retry in case it is installed later.
      setStatus('down')
      scheduleRestart()
      return
    }
    child = next
    liveTimer = setTimeout(() => {
      liveTimer = null
      if (gen !== generation) return
      attempt = 0
      setStatus('live')
    }, liveAfterMs)
    liveTimer.unref?.()
    void pump(next, gen)
    void next.exited.then(
      () => onExit(gen),
      () => onExit(gen),
    )
  }

  const onExit = (gen: number) => {
    if (gen !== generation) return
    child = null
    if (liveTimer) clearTimeout(liveTimer)
    liveTimer = null
    setStatus('down')
    scheduleRestart()
  }

  const stop = () => {
    generation += 1
    clearTimers()
    attempt = 0
    status = 'down'
    const owner = child
    child = null
    if (!owner) return
    try {
      owner.kill('SIGTERM')
    } catch {
      return
    }
    const escalate = setTimeout(() => {
      try {
        owner.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, KILL_ESCALATION_MS)
    escalate.unref?.()
    void owner.exited.then(
      () => clearTimeout(escalate),
      () => clearTimeout(escalate),
    )
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener({ kind: 'status', status })
      if (listeners.size === 1) start()
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        stop()
      }
    },
    stopAll() {
      listeners.clear()
      stop()
    },
  }
}

/**
 * `$.http`, `$.process`, `$.env` and `$.clock`, with Claude Code's limits: a fetch takes 30 s,
 * 5 redirects and 4 MiB each way; a process runs 30 s by default and 10 min at most, with no
 * shell. `$.env.set` changes only what this mod's own processes see. A mod's timers stop when the
 * mod unloads (`dispose`).
 */
const FETCH_MS = 30_000
const MAX_BODY = 4 * 1024 * 1024
const MAX_REDIRECTS = 5
const PROCESS_MS = 30_000
const PROCESS_MAX_MS = 10 * 60_000

export interface HttpInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export async function modFetch(url: string, init: HttpInit = {}, fetcher: typeof fetch = fetch) {
  if (init.body && init.body.length > MAX_BODY) throw new Error('the request body is over 4 MiB')
  const signal = AbortSignal.timeout(FETCH_MS)
  let target = url
  for (let hop = 0; ; hop++) {
    const response = await fetcher(target, { ...init, redirect: 'manual', signal })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`)
      target = new URL(location, target).href
      continue
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY && (init.method ?? 'GET').toUpperCase() !== 'HEAD')
      throw new Error(`the response is over the ${MAX_BODY}-byte limit`)
    const text = (await response.text()).slice(0, MAX_BODY)
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    }
  }
}

export interface ProcessInit {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
}

export function createSystemApi(input: { cwd: () => string; fetcher?: typeof fetch }) {
  const env: Record<string, string> = {}
  const timers = new Set<() => void>()
  const later = (fire: () => void, ms: number, repeat: boolean) => {
    const handle = repeat ? setInterval(fire, ms) : setTimeout(fire, ms)
    const cancel = () => {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
      clearInterval(handle as ReturnType<typeof setInterval>)
      timers.delete(cancel)
    }
    timers.add(cancel)
    return cancel
  }
  return {
    http: {
      fetch: (target: unknown, init?: HttpInit) => {
        const call =
          typeof target === 'string'
            ? { url: target, ...init }
            : (target as HttpInit & { url: string })
        return modFetch(call.url, call, input.fetcher)
      },
    },
    process: {
      async run(argv: readonly string[], init: ProcessInit = {}) {
        if (!Array.isArray(argv) || argv.length === 0) throw new Error('run takes an argv list')
        const proc = Bun.spawn([...argv], {
          cwd: init.cwd ?? input.cwd(),
          env: { ...process.env, ...env, ...init.env },
          stdin: init.stdin === undefined ? 'ignore' : new Blob([init.stdin]),
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const ms = Math.min(init.timeoutMs ?? PROCESS_MS, PROCESS_MAX_MS)
        const timer = setTimeout(() => proc.kill(), ms)
        try {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          return { exitCode, stdout, stderr }
        } finally {
          clearTimeout(timer)
        }
      },
    },
    env: {
      get: (name: unknown) => {
        const key = typeof name === 'string' ? name : (name as { name: string }).name
        return env[key] ?? process.env[key]
      },
      set: (name: unknown, value?: string) => {
        const call =
          typeof name === 'string' ? { name, value } : (name as { name: string; value?: string })
        if (call.value === undefined) delete env[call.name]
        else env[call.name] = call.value
      },
    },
    clock: {
      now: () => Date.now(),
      sleep: (ms: unknown) =>
        new Promise<void>((resolve) => {
          later(resolve, typeof ms === 'number' ? ms : (ms as { ms: number }).ms, false)
        }),
      after: (ms: number, fire: () => unknown) => later(() => void fire(), ms, false),
      every: (ms: number, fire: () => unknown) => later(() => void fire(), ms, true),
    },
    dispose() {
      for (const cancel of Array.from(timers)) cancel()
    },
  }
}

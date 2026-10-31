import { spawn } from 'node:child_process'
import { z } from 'zod'
import { awaitChildGone, releaseChildPipes } from '../../lib/child-exit'
import { childEnv } from '../../lib/login-shell-env'

/**
 * Dynamic mini-app-command argument options — the AGNOSTIC runner.
 *
 * A mini app command arg can declare `optionsScript: "./path.ts"` (see
 * `contracts-commands.ts`). When the composer opens that arg's picker, the core runs
 * the script in an isolated `bun` subprocess and renders whatever options come back.
 * The core knows nothing about what the values mean — git, docker, an HTTP API, all
 * live entirely inside the mini app's script.
 *
 * Contract with the script (TS or JS, run by `bun` directly — no build step):
 *  - IN : a JSON request on stdin — `{ query, cwd, sessionId, argName, command, config }`.
 *         Convenience env vars `LOCALIX_ARG_QUERY` / `LOCALIX_CWD` are also set.
 *  - OUT: an `ArgOption[]` JSON on stdout — `{ value, label?, description? }[]`
 *         (a bare string is read as `{ value, label: value }`).
 *
 * Isolation: separate process (`process.execPath` = the running bun), bounded by a
 * timeout + an output byte-cap, killed on either. NEVER throws and NEVER hangs — any
 * failure (bad exit, timeout, non-JSON) yields an empty menu.
 */

/**
 * What comes back across the process boundary is a zod contract — the single source
 * of truth for its TS type (`z.infer`) and its runtime validation: a subprocess can't
 * give us compile-time safety across stdout, so the schema IS the guarantee. The
 * request we send is a plain type, checked where it is built.
 */

/** One NORMALIZED option (route response shape + the parsed result type). */
export const argOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})
export type ArgOption = z.infer<typeof argOptionSchema>

/** The JSON request handed to the script on stdin. */
export interface ArgOptionsRequest {
  query: string
  cwd: string
  sessionId?: string
  argName: string
  command: string
  config?: Record<string, unknown>
}

/**
 * What a script MAY emit per element — deliberately lenient (a bare string, or an
 * object with an optional label/description). Normalized into an {@link ArgOption}
 * by {@link parseArgOptions}; a failed element is dropped, never fatal.
 */
const argOptionInputSchema = z.union([
  z.string(),
  z.object({
    value: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
  }),
])

/** Max time the options script may run before it's killed. */
const ARG_OPTIONS_TIMEOUT_MS = 8_000
/** Max stdout bytes captured (the process is killed past this). */
const ARG_OPTIONS_MAX_BYTES = 256 * 1024
/** Max options returned to the composer. */
export const ARG_OPTIONS_MAX_ITEMS = 200

/**
 * Run a mini app's options script and return its raw stdout. `scriptAbsPath` MUST be an
 * already-resolved, confinement-checked absolute path (the caller owns that). Never
 * throws — returns `''` on any failure/timeout.
 */
export function runArgOptionsScript(input: {
  scriptAbsPath: string
  cwd: string
  request: ArgOptionsRequest
  timeoutMs?: number
}): Promise<string> {
  const { scriptAbsPath, cwd, request } = input
  const timeoutMs = input.timeoutMs ?? ARG_OPTIONS_TIMEOUT_MS
  return new Promise<string>((resolveOut) => {
    let settled = false
    const finish = (out: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      releaseChildPipes(child)
      resolveOut(out)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, [scriptAbsPath], {
        cwd,
        // Login-shell env (a no-`env` spawn under Bun sees only the start snapshot)
        // plus the two convenience vars. PATH is preserved by childEnv.
        env: childEnv({ LOCALIX_ARG_QUERY: request.query, LOCALIX_CWD: cwd }),
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch {
      resolveOut('')
      return
    }

    const timer = setTimeout(() => finish(''), timeoutMs)
    const chunks: Buffer[] = []
    let bytes = 0
    child.stdout?.on('data', (d: Buffer) => {
      bytes += d.length
      if (bytes > ARG_OPTIONS_MAX_BYTES) {
        finish(Buffer.concat(chunks).toString('utf8'))
        return
      }
      chunks.push(d)
    })
    // Settle on the SCRIPT's exit, not on `'close'`. `'close'` waits for every
    // inherited stdio descriptor to close — including the ones the script handed to
    // anything it spawned (a helper started with inherited stdio outlives it). Such
    // a script has already WRITTEN its options and exited 0, but `'close'` would not
    // arrive: the picker then sat on the timeout and rendered an EMPTY menu for a
    // script that worked. `'close'` still wins when it comes (nothing truncated);
    // `onExit` clears the cap so a script that finished in time is not cut off during
    // the drain. A genuinely hung script is still killed at `timeoutMs` → empty menu.
    void awaitChildGone(child, { onExit: () => clearTimeout(timer) }).then(({ error }) => {
      finish(error ? '' : Buffer.concat(chunks).toString('utf8'))
    })

    // Feed the request; ignore EPIPE if the script never reads stdin.
    try {
      child.stdin?.on('error', () => {
        /* script closed stdin early — fine */
      })
      child.stdin?.end(JSON.stringify(request))
    } catch {
      /* ignore */
    }
  })
}

/** Normalize one validated input element into an {@link ArgOption} (null = drop). */
function normalizeOption(item: z.infer<typeof argOptionInputSchema>): ArgOption | null {
  if (typeof item === 'string') {
    const v = item.trim()
    return v ? { value: v, label: v } : null
  }
  if (!item.value) return null
  return {
    value: item.value,
    label: item.label?.length ? item.label : item.value,
    ...(item.description ? { description: item.description } : {}),
  }
}

/**
 * Parse a script's stdout into options against {@link argOptionInputSchema} — a JSON
 * array of objects (`{value,label?,description?}`) or bare strings. Validation is
 * PER ELEMENT (`safeParse`) so one malformed row is dropped, never the whole array;
 * non-JSON / non-array → `[]`. Capped at {@link ARG_OPTIONS_MAX_ITEMS}. Pure.
 */
export function parseArgOptions(stdout: string): ArgOption[] {
  const text = stdout.trim()
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: ArgOption[] = []
  for (const item of raw) {
    if (out.length >= ARG_OPTIONS_MAX_ITEMS) break
    const parsed = argOptionInputSchema.safeParse(item)
    if (!parsed.success) continue
    const norm = normalizeOption(parsed.data)
    if (norm) out.push(norm)
  }
  return out
}

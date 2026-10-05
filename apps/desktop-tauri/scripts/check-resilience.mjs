// Prove, against the real packaged app, that the shell keeps its API runtime alive.
//
//   bun scripts/check-resilience.mjs [--exe <path>] [--data <dir>] [--crashes <n>]
//
// It launches the app with a throwaway HOME (the person's data is never touched), then attacks the
// runtime the way real failures do and checks the shell's answer:
//
//   1. crash   kill -9 the runtime `--crashes` times in a row (default 3). Each time a NEW runtime
//              must answer /health. The shell used to start it again once per lifetime, so the
//              second crash left a window with no backend until the person restarted the app.
//   2. hang    SIGSTOP the runtime: alive, listening, silent. The shell must notice (about twenty
//              seconds of failed /health beats) and replace it. It used to wait forever.
//   3. quit    SIGTERM the app: the app and the runtime must both be gone, with no orphan left
//              holding the database.
//
// A local check, not a CI gate: it opens a real window and takes about a minute. Run it after a
// change to `sidecar.rs` or `supervisor.rs`, on a build from `tauri:build`.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)))

function option(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Poll `check` until it returns something truthy, or throw after `timeoutMs`. */
export async function waitFor(what, check, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await sleep(stepMs)
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Run one named step; prints how long it took, and rethrows on failure after saying so. */
async function step(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    console.log(
      `  PASS  ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)${detail ? ` ${detail}` : ''}`,
    )
  } catch (error) {
    console.log(`  FAIL  ${name}: ${error.message}`)
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const exe =
    option(args, '--exe') ??
    join(
      desktop,
      'src-tauri',
      'target',
      'release',
      'bundle',
      'macos',
      'Localix.app',
      'Contents',
      'MacOS',
      'desktop-tauri',
    )
  if (!existsSync(exe)) {
    console.error(`[resilience] ${exe} is missing; build the app first (bun run tauri:build)`)
    process.exit(2)
  }
  const crashes = Number(option(args, '--crashes') ?? 3)
  const home = mkdtempSync(join(tmpdir(), 'localix-resilience-'))
  const data = option(args, '--data')
  if (data) cpSync(data, join(home, '.localix'), { recursive: true })
  const endpointFile = join(home, '.localix', 'api-runtime.json')
  const endpoint = () => {
    try {
      return JSON.parse(readFileSync(endpointFile, 'utf8'))
    } catch {
      return undefined
    }
  }
  const healthy = async (baseUrl) => {
    try {
      return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })).ok
    } catch {
      return false
    }
  }
  /** The runtime that is serving now, once it is a different process from `previous` and healthy. */
  const nextRuntime = (previous, timeoutMs) =>
    waitFor(
      'a new runtime answering /health',
      async () => {
        const current = endpoint()
        return current &&
          current.pid !== previous &&
          isAlive(current.pid) &&
          (await healthy(current.baseUrl))
          ? current
          : undefined
      },
      timeoutMs,
    )

  console.log(`[resilience] ${exe}\n[resilience] home ${home}`)
  const app = spawn(exe, [], { env: { ...process.env, HOME: home }, stdio: 'ignore' })
  let failed = false
  try {
    let runtime
    await step('start', async () => {
      runtime = await waitFor(
        'the first runtime',
        async () => {
          const current = endpoint()
          return current && (await healthy(current.baseUrl)) ? current : undefined
        },
        30_000,
      )
      return `pid ${runtime.pid}`
    })

    for (let n = 1; n <= crashes; n += 1) {
      await step(`crash ${n} of ${crashes}: kill -9 the runtime`, async () => {
        const dead = runtime.pid
        process.kill(dead, 'SIGKILL')
        runtime = await nextRuntime(dead, 20_000)
        return `replaced by pid ${runtime.pid}`
      })
    }

    await step('hang: SIGSTOP the runtime, expect it replaced', async () => {
      const frozen = runtime.pid
      process.kill(frozen, 'SIGSTOP')
      try {
        runtime = await nextRuntime(frozen, 60_000)
      } finally {
        // Whatever happened, do not leave a stopped process behind.
        try {
          process.kill(frozen, 'SIGKILL')
        } catch {}
      }
      return `replaced by pid ${runtime.pid}`
    })

    await step('quit: SIGTERM the app, expect no process left', async () => {
      const last = runtime.pid
      app.kill('SIGTERM')
      await waitFor(
        'the app to exit',
        () => app.exitCode !== null || app.signalCode !== null,
        15_000,
      )
      await waitFor('the runtime to exit', () => !isAlive(last), 15_000)
    })
  } catch {
    failed = true
  } finally {
    const last = endpoint()?.pid
    for (const pid of [app.pid, last]) {
      if (pid && isAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
    }
    // Show what the shell said, which is the diagnosis when a step failed.
    const log = join(home, '.localix', 'logs', 'desktop.log')
    if (existsSync(log)) {
      const lines = readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) =>
          /respawning|treating it as hung|API startup failed|runtime ready on port/u.test(line),
        )
        .map((line) => {
          try {
            return JSON.parse(line).msg
          } catch {
            return line
          }
        })
      console.log(
        `\nshell log (${lines.length} relevant lines):\n  ${lines.slice(-14).join('\n  ')}`,
      )
    }
    rmSync(home, { recursive: true, force: true })
  }
  console.log(failed ? '\n[resilience] FAILED' : '\n[resilience] all steps passed')
  process.exit(failed ? 1 : 0)
}

if (import.meta.main) await main()

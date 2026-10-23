// Start the API exactly the way the desktop shell does, from the staged bundle, and prove it
// serves. A packaged app whose sidecar cannot start (a missing resource, a migration that does not
// resolve `kysely`, a native addon for the wrong platform) used to ship signed and notarized,
// because nothing before a human launch ran `server.js` out of `resources/`.
//
//   bun scripts/smoke-bundle.mjs [--bun <path>] [--resources <dir>] [--timeout <seconds>]
//   bun scripts/smoke-bundle.mjs --root <dir>   find both inside a built or extracted app
//
// It needs no Rust and no Tauri: only what `prepare-sidecar.mjs` stages. The runtime runs against a
// throwaway home directory, so it never touches the user's `~/.localix`.
import { spawn } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { STAGED_APPS_DIR } from '../../../scripts/lib/bundled-roots.mjs'
import {
  DESKTOP_RUNTIME_ARG,
  LOCALIX_RUNTIME_READY_PREFIX,
  RUNTIME_ENV,
  RUNTIME_SHUTDOWN_COMMAND,
} from '../../api/src/lib/runtime-protocol.ts'

/** The stdout frame the runtime prints once it is serving, from the shell <-> runtime contract. */
export const READY_PREFIX = LOCALIX_RUNTIME_READY_PREFIX

const LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/u

/** The endpoint announced on a READY line, or undefined when the line is anything else. */
export function parseReadyLine(line) {
  if (!line.startsWith(READY_PREFIX)) return undefined
  let endpoint
  try {
    endpoint = JSON.parse(line.slice(READY_PREFIX.length))
  } catch {
    return undefined
  }
  const baseUrl = endpoint?.baseUrl
  return typeof baseUrl === 'string' && LOOPBACK_URL.test(baseUrl) ? endpoint : undefined
}

/** Resolve with the first value `check` returns before `ms` elapse, else reject with `message`. */
function within(ms, message, register) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    register(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Run `bun server.js --desktop-runtime`, wait for READY, read `/health`, ask it to shut down and
 * require a clean exit. Resolves with a summary; rejects with the reason and the child's output.
 */
export async function smokeRuntime({
  bun,
  serverJs,
  readyTimeoutMs = 30_000,
  exitTimeoutMs = 10_000,
  env = {},
}) {
  const home = mkdtempSync(join(tmpdir(), 'localix-smoke-'))
  const child = spawn(bun, [serverJs, DESKTOP_RUNTIME_ARG], {
    cwd: home,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData'),
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      // Set only by the shell; arms the runtime's stdin shutdown channel.
      [RUNTIME_ENV.parentPid]: String(process.pid),
      ...env,
    },
  })
  const output = []
  const tail = () => output.join('').slice(-2_000).trim()
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  child.once('error', (error) => output.push(`spawn error: ${error.message}\n`))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))

  try {
    const endpoint = await within(
      readyTimeoutMs,
      'no READY line before the timeout',
      (ok, fail) => {
        let buffered = ''
        child.stdout.on('data', (chunk) => {
          output.push(String(chunk))
          buffered += String(chunk)
          const lines = buffered.split('\n')
          buffered = lines.pop() ?? ''
          for (const line of lines) {
            const found = parseReadyLine(line.trim())
            if (found) return ok(found)
          }
        })
        void exited.then(({ code, signal }) =>
          fail(new Error(`exited before READY (${signal ?? code})`)),
        )
      },
    )

    const response = await fetch(`${endpoint.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    const health = await response.json()
    if (!response.ok || health.status !== 'ok' || health.productId !== 'localix-api') {
      throw new Error(`/health answered ${response.status} ${JSON.stringify(health)}`)
    }

    child.stdin.write(`${RUNTIME_SHUTDOWN_COMMAND}\n`)
    const { code, signal } = await within(
      exitTimeoutMs,
      'still running after `shutdown`',
      (ok) => void exited.then(ok),
    )
    if (code !== 0) throw new Error(`exited with ${signal ?? code} after \`shutdown\``)
    return { baseUrl: endpoint.baseUrl, protocolVersion: health.protocolVersion }
  } catch (error) {
    throw new Error(`${error.message}\n--- runtime output ---\n${tail() || '(none)'}`, {
      cause: error,
    })
  } finally {
    child.kill('SIGKILL')
    await exited
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Copy the staged bundle somewhere no ancestor directory has a `node_modules`. Inside the checkout
 * a missing vendored `kysely` still resolves from the repository's own `node_modules`, so the run
 * would pass for a bundle that fails on a user's machine. Returns the copy and a way to remove it.
 */
export function copyBundleOutsideRepo({ bun, resources }) {
  const root = mkdtempSync(join(tmpdir(), 'localix-bundle-'))
  const bunCopy = join(root, basename(bun))
  copyFileSync(bun, bunCopy)
  cpSync(resources, join(root, 'resources'), { recursive: true })
  return {
    bun: bunCopy,
    serverJs: join(root, 'resources', 'server.js'),
    remove: () => rmSync(root, { recursive: true, force: true }),
  }
}

const SIDECAR_NAMES = new Set(['bun', 'bun.exe'])
// The sidecar is a full Bun runtime; nothing else named `bun` in an app is anywhere near this big.
const MIN_SIDECAR_BYTES = 20 * 1024 * 1024

/**
 * Find the sidecar and the staged resources inside a packaged app: a macOS `.app`, an extracted
 * AppImage (`squashfs-root`), an unpacked `.deb` or an installed Windows directory. The layouts
 * differ, so this looks for what is distinctive rather than hard-coding each one: a `resources`
 * directory holding `server.js` and `plugins`, and a large executable named `bun`.
 */
export function locateBundle(root, maxDepth = 8) {
  let bun
  let resources
  const visit = (dir, depth) => {
    if (depth > maxDepth || (bun && resources)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (
          entry.name === 'resources' &&
          !resources &&
          existsSync(join(path, 'server.js')) &&
          existsSync(join(path, STAGED_APPS_DIR))
        ) {
          resources = path
        } else visit(path, depth + 1)
      } else if (
        entry.isFile() &&
        !bun &&
        SIDECAR_NAMES.has(entry.name) &&
        statSync(path).size >= MIN_SIDECAR_BYTES
      ) {
        bun = path
      }
    }
  }
  visit(root, 0)
  return bun && resources ? { bun, resources } : undefined
}

function option(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

async function main() {
  const args = process.argv.slice(2)
  // Loaded lazily: `hostTriple()` shells out to rustc, which a caller naming `--bun` does not need.
  const staging = await import('./tauri-staging.mjs')
  const root = option(args, '--root')
  const found = root ? locateBundle(root) : undefined
  if (root && !found) {
    console.error(`[smoke-bundle] no sidecar and resources/server.js found under ${root}`)
    process.exit(2)
  }
  const bun = found?.bun ?? option(args, '--bun') ?? staging.sidecarPath()
  const resources = found?.resources ?? option(args, '--resources') ?? staging.resourcesDir
  for (const path of [bun, join(resources, 'server.js'), join(resources, STAGED_APPS_DIR)]) {
    if (!existsSync(path)) {
      console.error(`[smoke-bundle] ${path} is missing; run scripts/prepare-sidecar.mjs first`)
      process.exit(2)
    }
  }
  const seconds = Number(option(args, '--timeout') ?? 30)
  const started = Date.now()
  const copy = copyBundleOutsideRepo({ bun, resources })
  try {
    const result = await smokeRuntime({
      bun: copy.bun,
      serverJs: copy.serverJs,
      readyTimeoutMs: seconds * 1_000,
    })
    console.log(
      `[smoke-bundle] ok in ${((Date.now() - started) / 1_000).toFixed(1)}s: ` +
        `${result.baseUrl}/health (protocol ${result.protocolVersion}), clean shutdown`,
    )
  } catch (error) {
    console.error(`[smoke-bundle] FAILED: ${error.message}`)
    process.exitCode = 1
  } finally {
    copy.remove()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()

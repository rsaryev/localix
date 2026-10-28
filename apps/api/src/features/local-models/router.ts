/**
 * The model router: ONE managed `llama-server` in router mode serving every installed local
 * model — chat models behind the `local` provider and the embedding model behind semantic search.
 *
 * Each installed model is a preset section (`[<model id>]`) naming its files and the flags its
 * plan for this computer sets — context, cache type, its draft model; a request's `model` field picks the instance and the router loads it on demand,
 * unloading the least recently used past `MAX_LOADED`. Installing or removing a model rewrites
 * the presets and asks a running router to reload them — no restart, no second process. The
 * router starts on the first request and stops after `idleMs` without one. API processes that
 * share a models folder share its router too (router-claim.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DraftMethod, LocalModelSpec } from './contracts'
import type { InstallPaths } from './installer'
import { startLlamaServer, type LlamaServer, type LlamaServerOptions } from './llama-server'
import type { ModelPlan } from './planner'
import {
  borrowedServer,
  clearClaim,
  lastUsed,
  readClaim,
  realSharedRouterOs,
  recordUse,
  routerFiles,
  withLaunchLock,
  writeClaim,
  type RouterClaim,
  type SharedRouterOs,
} from './router-claim'

/** Models resident at once: one chat model and the embedding model fit beside each other. */
export const MAX_LOADED = 2
const DEFAULT_IDLE_MS = 15 * 60_000
const START_TIMEOUT_MS = 60_000
/** How long past a start's own timeout another API waits on the launch lock before taking it. */
const LOCK_MARGIN_MS = 10_000
/** A loaded model idle this long gives its memory back; the router itself keeps running. */
const MODEL_SLEEP_SECONDS = 600
/** Chat context when a model has no plan (the computer's profile is unknown): bounded and safe. */
export const CHAT_CONTEXT_FALLBACK = 16_384
const SPEC_TYPE: Record<DraftMethod, string> = {
  mtp: 'draft-mtp',
  dflash: 'draft-dflash',
  dspark: 'draft-dspark',
}

/** An installed model and how it runs here. */
export interface RoutedModel {
  spec: LocalModelSpec
  plan: ModelPlan | null
}

export interface RouterDeps {
  paths: InstallPaths
  /** The runtime executable, or null when it is not installed yet. */
  executable: () => Promise<string | null>
  models: () => Promise<RoutedModel[]>
  idleMs?: number
  log?: (event: string, fields: Record<string, unknown>) => void
  /** Test seam. */
  start?: (options: LlamaServerOptions) => Promise<LlamaServer>
  /** Test seams for sharing the router with other API processes (router-claim.ts). */
  shared?: Partial<SharedRouterOs>
}

/** One model's preset section: its files, plus what its kind and its plan need. */
export function presetSection(model: RoutedModel, paths: InstallPaths): string[] {
  const { spec, plan } = model
  const file = (role: string) => spec.files.find((f) => f.role === role)
  const weights = file('weights')!
  const lines = [`[${spec.id}]`, `model = ${paths.modelFile(spec.id, weights.name)}`]
  if (spec.kind === 'embedding') {
    // Non-causal embedding inputs must fit one micro-batch whole; four parallel slots. It serves
    // background indexing, so it runs at low priority and sleeps between batches instead of
    // polling, leaving the CPU to the person's chat model and the app.
    lines.push('embeddings = true', 'c = 4096', 'np = 4', 'b = 1024', 'ub = 1024')
    lines.push('prio = -1', 'poll = 0')
    return lines
  }
  const context = plan?.context ?? Math.min(spec.contextLength ?? 8192, CHAT_CONTEXT_FALLBACK)
  lines.push('jinja = true', `c = ${context}`, 'np = 1', 'fa = on')
  // Key and value share one type: mixed types leave Metal's fast attention path.
  if (plan?.kv === 'q8_0') lines.push('ctk = q8_0', 'ctv = q8_0')
  const projector = file('projector')
  if (projector) lines.push(`mmproj = ${paths.modelFile(spec.id, projector.name)}`)
  const draft = file('draft')
  if (draft && spec.draft) {
    lines.push(
      `md = ${paths.modelFile(spec.id, draft.name)}`,
      `spec-type = ${SPEC_TYPE[spec.draft.method]}`,
      'ngld = 99',
    )
  }
  return lines
}

export function presetsIni(models: readonly RoutedModel[], paths: InstallPaths): string {
  const sections = models.map((model) => presetSection(model, paths).join('\n'))
  return [
    'version = 1',
    '',
    '[*]',
    'no-webui = true',
    `sleep-idle-seconds = ${MODEL_SLEEP_SECONDS}`,
    '',
    ...sections,
    '',
  ].join('\n')
}

export function createModelRouter(deps: RouterDeps) {
  const routerDir = path.join(deps.paths.root, 'router')
  const presetsPath = path.join(routerDir, 'presets.ini')
  const files = routerFiles(routerDir)
  const os: SharedRouterOs = { ...realSharedRouterOs, ...deps.shared }
  const start = deps.start ?? startLlamaServer
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS
  // How often a use is written down for the other APIs: often enough for the owner's idle check.
  const recordEveryMs = Math.min(idleMs / 4, 30_000)
  let server: LlamaServer | null = null
  /** Whether `server` is the router this process started, and so the one it stops. */
  let owned = false
  let starting: Promise<LlamaServer> | null = null
  let lastError: string | null = null
  let cancelIdle: (() => void) | null = null
  let recordedAt = Number.NEGATIVE_INFINITY

  async function writePresets() {
    await mkdir(routerDir, { recursive: true })
    await writeFile(presetsPath, presetsIni(await deps.models(), deps.paths))
  }

  function armIdle(ms = idleMs) {
    cancelIdle?.()
    cancelIdle = os.schedule(() => idle(), ms)
  }

  /** Stop after `idleMs` with no use — by this API, or by any other using the same router. */
  async function idle() {
    if (owned) {
      const quiet = os.now() - ((await lastUsed(files.activity)) ?? Number.NEGATIVE_INFINITY)
      if (quiet < idleMs) return armIdle(idleMs - quiet)
    }
    await stop()
  }

  function noteUse() {
    const now = os.now()
    if (now - recordedAt < recordEveryMs) return
    recordedAt = now
    void recordUse(files.activity, now).catch(() => undefined)
  }

  /** Kill what the claim names when no live API owns it. */
  async function reapUnowned(claim: RouterClaim | null): Promise<boolean> {
    let reaped = false
    if (claim && (claim.ownerPid === os.self || !os.isAlive(claim.ownerPid))) {
      if (await os.reap(claim.routerPid, presetsPath)) reaped = true
      await clearClaim(files.claim, claim.ownerPid)
    }
    return reaped
  }

  /** A router another live API started and still answers to its key: use it, start nothing. */
  async function borrowable(claim: RouterClaim | null): Promise<RouterClaim | null> {
    if (!claim || claim.ownerPid === os.self) return null
    if (!os.isAlive(claim.ownerPid) || !os.isAlive(claim.routerPid)) return null
    return (await os.probe(claim)) ? claim : null
  }

  async function launch(): Promise<LlamaServer> {
    const executable = await deps.executable()
    if (!executable) throw new Error('The local model runtime is not installed')
    return withLaunchLock(files.lock, os, START_TIMEOUT_MS + LOCK_MARGIN_MS, async () => {
      const claim = await readClaim(files.claim)
      const shared = await borrowable(claim)
      if (shared) {
        owned = false
        lastError = null
        deps.log?.('local_models.router_shared', { url: shared.baseUrl, ownerPid: shared.ownerPid })
        return borrowedServer(shared, os)
      }
      if (await reapUnowned(claim)) deps.log?.('local_models.router_reaped', { routerDir })
      await writePresets()
      const started = await start({
        executable,
        cwd: path.dirname(executable),
        startTimeoutMs: START_TIMEOUT_MS,
        args: (port, apiKey) => [
          '--models-preset',
          presetsPath,
          '--models-max',
          String(MAX_LOADED),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--api-key',
          apiKey,
          '--offline',
        ],
        onExit: ({ code, stderrTail }) => {
          server = null
          lastError = `The local model server stopped (${code}): ${stderrTail.split('\n').slice(-3).join(' ')}`
          deps.log?.('local_models.router_exited', { code })
        },
      })
      owned = true
      lastError = null
      await writeClaim(files.claim, {
        routerPid: started.pid,
        ownerPid: os.self,
        baseUrl: started.baseUrl,
        apiKey: started.apiKey,
      })
      deps.log?.('local_models.router_started', { url: started.baseUrl })
      return started
    })
  }

  async function stop() {
    cancelIdle?.()
    cancelIdle = null
    // A server still starting would otherwise come up after the stop with nothing to own it.
    const pending = starting
    if (pending) await pending.catch(() => null)
    const running = server
    const wasOwned = owned
    server = null
    owned = false
    // Another API's router is that API's to stop; letting go of it is all there is to do.
    if (!running || !wasOwned) return
    await running.stop()
    await clearClaim(files.claim, os.self)
  }

  return {
    /** The running router, started (or found) when needed. Every request goes through here. */
    async ensure(): Promise<LlamaServer> {
      armIdle()
      noteUse()
      if (server?.running) return server
      starting ??= launch()
        .then((s) => (server = s))
        .catch((err: unknown) => {
          lastError = err instanceof Error ? err.message : String(err)
          throw err
        })
        .finally(() => {
          starting = null
        })
      return starting
    },

    /** The installed set changed: rewrite presets; a running router re-reads them. */
    async reload() {
      await writePresets()
      if (server?.running) {
        await server.request('/models?reload=1').catch(() => undefined)
      }
    },

    /** Loaded/unloaded per model, from a running router (empty when it is not running). */
    async loaded(): Promise<Array<{ id: string; status: string }>> {
      if (!server?.running) return []
      const res = await server.request('/models').catch(() => null)
      if (!res?.ok) return []
      const body = (await res.json()) as {
        data?: Array<{ id: string; status?: { value?: string } }>
      }
      return (body.data ?? []).map((m) => ({ id: m.id, status: m.status?.value ?? 'unknown' }))
    },

    /** Kill a router no live API owns any more (boot: free its memory now). */
    async reapStale(): Promise<void> {
      if (server?.running || starting) return
      if (await reapUnowned(await readClaim(files.claim))) {
        deps.log?.('local_models.router_reaped', { routerDir })
      }
    },

    state: () => ({
      running: !!server?.running,
      starting: !!starting,
      error: lastError,
    }),

    stop,
  }
}

export type ModelRouter = ReturnType<typeof createModelRouter>

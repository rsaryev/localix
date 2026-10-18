/**
 * The model router: ONE managed `llama-server` in router mode serving every installed local
 * model — chat models behind the `local` provider and the embedding model behind semantic search.
 *
 * Each installed model is a preset section (`[<model id>]`) naming its files and the flags its
 * plan for this computer sets — context, cache type, its draft model; a request's `model` field picks the instance and the router loads it on demand,
 * unloading the least recently used past `MAX_LOADED`. Installing or removing a model rewrites
 * the presets and asks a running router to reload them — no restart, no second process. The
 * router starts on the first request and stops after `idleMs` without one.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DraftMethod, LocalModelSpec } from './contracts'
import type { InstallPaths } from './installer'
import { startLlamaServer, type LlamaServer, type LlamaServerOptions } from './llama-server'
import type { ModelPlan } from './planner'
import { forgetServer, reapStaleServer, recordServer } from './stale-server'

/** Models resident at once: one chat model and the embedding model fit beside each other. */
export const MAX_LOADED = 2
const DEFAULT_IDLE_MS = 15 * 60_000
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
}

/** One model's preset section: its files, plus what its kind and its plan need. */
export function presetSection(model: RoutedModel, paths: InstallPaths): string[] {
  const { spec, plan } = model
  const file = (role: string) => spec.files.find((f) => f.role === role)
  const weights = file('weights')!
  const lines = [`[${spec.id}]`, `model = ${paths.modelFile(spec.id, weights.name)}`]
  if (spec.kind === 'embedding') {
    // Non-causal embedding inputs must fit one micro-batch whole; four parallel slots.
    lines.push('embeddings = true', 'c = 4096', 'np = 4', 'b = 1024', 'ub = 1024')
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
  const presetsPath = path.join(deps.paths.root, 'router', 'presets.ini')
  const pidFile = path.join(deps.paths.root, 'router', 'router.pid')
  const start = deps.start ?? startLlamaServer
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS
  let server: LlamaServer | null = null
  let starting: Promise<LlamaServer> | null = null
  let lastError: string | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  async function writePresets() {
    await mkdir(path.dirname(presetsPath), { recursive: true })
    await writeFile(presetsPath, presetsIni(await deps.models(), deps.paths))
  }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => void stop(), idleMs)
    idleTimer.unref?.()
  }

  async function launch(): Promise<LlamaServer> {
    const executable = await deps.executable()
    if (!executable) throw new Error('The local model runtime is not installed')
    if (await reapStaleServer(pidFile, presetsPath)) {
      deps.log?.('local_models.router_reaped', { pidFile })
    }
    await writePresets()
    const started = await start({
      executable,
      cwd: path.dirname(executable),
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
    lastError = null
    await recordServer(pidFile, started.pid)
    deps.log?.('local_models.router_started', { url: started.baseUrl })
    return started
  }

  async function stop() {
    if (idleTimer) clearTimeout(idleTimer)
    // A server still starting would otherwise come up after the stop with nothing to own it.
    const pending = starting
    if (pending) await pending.catch(() => null)
    const running = server
    server = null
    await running?.stop()
    if (running) await forgetServer(pidFile)
  }

  return {
    /** The running router, started when needed. Every request goes through here. */
    async ensure(): Promise<LlamaServer> {
      armIdle()
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

    /** Kill a router an earlier process left running (boot: free its memory now). */
    async reapStale(): Promise<void> {
      if (server?.running || starting) return
      if (await reapStaleServer(pidFile, presetsPath)) {
        deps.log?.('local_models.router_reaped', { pidFile })
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

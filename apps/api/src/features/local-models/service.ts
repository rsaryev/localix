/**
 * Local models, composed: catalog, installs, the runtime and the model router.
 *
 * Every consumer goes through here — the `local` chat provider, semantic search's embedding
 * engine, the settings tab and the model picker — so a model is downloaded, verified, listed
 * and served one way. Downloads queue in {@link createInstallQueue}; the computer is profiled once
 * (again when the runtime arrives and can report its devices), and every installed model is
 * planned for it before the router serves it. Nothing downloads unless a person asks for it.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { InstallJob, LocalModelKind, LocalModelSpec, LocalModelsStatus } from './contracts'
import { labelOf } from './hf-catalog'
import { PINNED_MODELS, REQUIRED_MODELS } from './pinned'
import { requiredModels } from './required'
import { whenInstalled } from './when-installed'
import { createLocalCatalog } from './catalog'
import { createHfClient, type HfClient } from './hf-client'
import {
  installPaths,
  isRuntimeInstalled,
  listInstalledModels,
  listPartialModels,
  type PartialModel,
  pendingModelBytes,
  removeInstalledModel,
  discardDownload,
} from './installer'
import type { LlamaServer, LlamaServerOptions } from './llama-server'
import type { MachineProfile } from './machine'
import { createMachinePlans } from './machine-plans'
import { createBackgroundDownloads, type BackgroundDownloads } from './background'
import { createInstallQueue } from './install-queue'
import { createSignal } from './signal'
import type { ModelPlan } from './planner'
import { createModelRouter } from './router'
import { buildStatus } from './status'
import { runtimeBuildFor, type RuntimeBuild } from './runtime'

export interface LocalModelsDeps {
  /** `~/.localix/models` in production. */
  root: string
  log?: (event: string, fields: Record<string, unknown>) => void
  /** A Hugging Face token (`HF_TOKEN`): higher rate limits, gated repositories. */
  hfToken?: string
  /** Test seams. */
  hf?: HfClient
  detect?: (executable: string | null) => Promise<MachineProfile>
  runtimeBuild?: RuntimeBuild | null
  startServer?: (options: LlamaServerOptions) => Promise<LlamaServer>
  routerIdleMs?: number
  /** The models kept on this computer; `REQUIRED_MODELS` in production. */
  requiredModels?: readonly LocalModelSpec[]
  /**
   * Announce what is installed on the core change feed (`local.model`): a model installed or
   * removed by its id, and `resync` once boot has read what is on disk. Its files are the truth,
   * so there is no transaction to join.
   */
  announce?: (change: { op: 'upserted' | 'deleted'; id: string } | { op: 'resync' }) => void
}

/** How often failed background downloads (the models Localix keeps) are tried again. */
const BACKGROUND_RETRY_MS = 15 * 60_000

export function createLocalModelsService(deps: LocalModelsDeps) {
  const paths = installPaths(deps.root)
  const build = deps.runtimeBuild === undefined ? runtimeBuildFor() : deps.runtimeBuild
  const required = requiredModels(deps.requiredModels ?? REQUIRED_MODELS)
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let installed: LocalModelSpec[] = []
  let partial: PartialModel[] = []
  let runtimeInstalled = false
  const progress = createSignal()
  const notify = progress.emit
  // Rarer than `notify` (every progress tick): the set of listable models changed.
  const list = createSignal()
  const listChanged = list.emit

  const machine = createMachinePlans({
    paths,
    detect: deps.detect,
    executable: () => (build && runtimeInstalled ? paths.runtimeExecutable(build) : null),
    installed: () => installed,
  })

  const catalog = createLocalCatalog({
    root: deps.root,
    hf: deps.hf ?? createHfClient(fetch, { token: deps.hfToken }),
    installed: () => installed,
    machine: machine.profile,
    log: deps.log,
  })

  const router = createModelRouter({
    paths,
    executable: async () =>
      build && (await isRuntimeInstalled(paths, build)) ? paths.runtimeExecutable(build) : null,
    models: async () => installed.map((spec) => ({ spec, plan: machine.planOf(spec.id) })),
    idleMs: deps.routerIdleMs,
    log: deps.log,
    ...(deps.startServer ? { start: deps.startServer } : {}),
  })

  /** A manifest's name as the catalog names it today; the pinned model keeps its own. */
  const named = (spec: LocalModelSpec): LocalModelSpec =>
    required.mark(
      PINNED_MODELS.some((p) => p.id === spec.id) ? spec : { ...spec, label: labelOf(spec.repo) },
    )

  const isInstalled = (modelId: string) => installed.some((s) => s.id === modelId)

  async function refresh() {
    installed = (await listInstalledModels(paths)).map(named)
    partial = (await listPartialModels(paths)).map((p) => ({ ...p, spec: named(p.spec) }))
    runtimeInstalled = build ? await isRuntimeInstalled(paths, build) : false
    await machine.replan()
    // What is here changed: a wanted model that went missing downloads again.
    background.reconcile()
  }

  const downloads = createInstallQueue({
    paths,
    build,
    notify,
    installed: async (spec, runtimeAdded) => {
      await refresh()
      // A first runtime install: llama.cpp can now report this computer's devices itself.
      if (runtimeAdded) await machine.detect()
      await router.reload()
      listChanged()
      deps.announce?.({ op: 'upserted', id: spec.id })
    },
    stopped: refresh,
    log: deps.log,
  })
  const background: BackgroundDownloads = createBackgroundDownloads({
    isInstalled,
    jobs: () => downloads.list(),
    start: (spec, options) => downloads.start(spec, options),
    pause: async (modelId) => void (await downloads.stop(modelId, 'pause')),
    log: deps.log,
  })

  return {
    async boot() {
      // The catalog's cache before it was split into listings and exact specs.
      await rm(path.join(deps.root, 'catalog-cache.json'), { force: true })
      await router.reapStale()
      await refresh()
      // What is installed is known only now; a catalog read before boot listed nothing local.
      listChanged()
      deps.announce?.({ op: 'resync' })
      await machine.detect()
      // Downloads quitting cut short go on — quietly when they were fetched ahead of need —
      // and the ones a person paused wait for them.
      for (const { spec, background: quiet } of partial.filter((p) => p.resume)) {
        void downloads.start(spec, { background: quiet })
      }
      // The models Localix keeps here are wanted always, by local models itself: no consumer owns
      // their download, and a missing one (a failed fetch, files gone) comes back on its own.
      // Declared once what is installed and resuming is known, so nothing is fetched twice.
      background.declare('required', () => required.models)
      // A failed background download is tried again on its own, quietly: no one is asked to.
      retryTimer = setInterval(() => background.reconcile({ retry: true }), BACKGROUND_RETRY_MS)
      retryTimer.unref?.()
    },

    catalog,
    router,
    /** Models features want ahead of need (`background.ts`). */
    background,
    paths,

    installed: (kind?: LocalModelKind) =>
      kind ? installed.filter((s) => s.kind === kind) : installed,
    isInstalled,
    /** How an installed model runs here — the context its server is started with. */
    planOf: (modelId: string): ModelPlan | null => machine.planOf(modelId),

    /**
     * Start downloading a model (and the runtime). For an installed model it fetches only what
     * the catalog's current spec adds (a draft model), keeping every file already here.
     */
    async install(modelOrSpec: string | LocalModelSpec): Promise<InstallJob> {
      const spec =
        typeof modelOrSpec === 'string'
          ? ((await catalog.latest(modelOrSpec)) ?? (await catalog.resolve(modelOrSpec)))
          : modelOrSpec
      if (!spec) {
        const asked = typeof modelOrSpec === 'string' ? modelOrSpec : modelOrSpec.id
        throw new Error(`Unknown local model "${asked}"`)
      }
      if (isInstalled(spec.id) && (await pendingModelBytes(paths, spec)) === 0) {
        return {
          modelId: spec.id,
          label: spec.label,
          background: false,
          phase: 'verifying',
          received: spec.bytes,
          total: spec.bytes,
          rate: null,
          error: null,
        }
      }
      void downloads.start(spec)
      return downloads.job(spec.id)!
    },

    /** Wait for a model to be installed (starting its download if needed). */
    async ensureInstalled(spec: LocalModelSpec): Promise<boolean> {
      if (isInstalled(spec.id)) return true
      await downloads.start(spec)
      return isInstalled(spec.id)
    },

    job: (modelId: string): InstallJob | null => downloads.job(modelId),

    /**
     * Resolve once a model is installed, waiting out its download; reject with what a person can
     * do when it is not coming — a paused or failed download, or none at all.
     */
    whenReady(modelId: string, label: string, signal?: AbortSignal): Promise<void> {
      return whenInstalled(
        {
          isInstalled,
          job: (id) => downloads.job(id),
          paused: (id) => partial.find((p) => p.spec.id === id),
          subscribe: progress.on,
        },
        modelId,
        label,
        signal,
      )
    },

    /** Stop a download and keep what it fetched; `install` resumes it. */
    async pause(modelId: string) {
      await downloads.stop(modelId, 'pause')
    },

    /** Stop a download — running or paused — and delete what it fetched. */
    async cancel(modelId: string) {
      required.keep(modelId)
      // A person cancelling a download fetched ahead of need has decided against it, for now.
      if (downloads.job(modelId)?.background) background.decline(modelId)
      if (await downloads.stop(modelId, 'cancel')) return
      if (partial.some((p) => p.spec.id === modelId)) {
        await discardDownload(paths, modelId)
        await refresh()
        notify()
      }
    },

    async remove(modelId: string) {
      required.keep(modelId)
      downloads.drop(modelId)
      await removeInstalledModel(paths, modelId)
      await refresh()
      await router.reload()
      listChanged()
      deps.announce?.({ op: 'deleted', id: modelId })
      notify()
    },

    async status(): Promise<LocalModelsStatus> {
      return buildStatus({
        runtime: { supported: !!build, tag: build?.tag ?? null, installed: runtimeInstalled },
        installed,
        jobs: downloads.list(),
        partial,
        loaded: await router.loaded(),
        machine: machine.profile(),
      })
    },

    subscribe: progress.on,

    /** Installed or listable models changed — what a provider's model list reads. */
    onListChanged: list.on,

    async shutdown() {
      if (retryTimer) clearInterval(retryTimer)
      // A download cut by quitting is paused, not lost: its files resume next time.
      downloads.pauseAll()
      await router.stop()
    },
  }
}

export type LocalModelsService = ReturnType<typeof createLocalModelsService>

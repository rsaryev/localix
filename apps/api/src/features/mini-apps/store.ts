import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { errorMessage } from '../../lib/errors'
import { listSubdirs } from '../ext/fs-discovery'
import { installBundledMiniApp } from './bundled-install'
import { bundledMiniAppsSyncRoot } from './discovery'
import { MINI_APPS_SUBDIR } from './paths'

/**
 * The mini app store: what the catalogs offer, what is installed, and the installs in flight
 * (`docs/internals/plugins-and-mini-apps.md`, "Catalogs and sources"). Nothing is installed until
 * the person chooses it (rule X5). An install is in-memory status — every move of a job tells the
 * subscribers, which poke `mini-app-installs` so the client re-reads the list — and a finished one
 * is announced as the app's `mini-app` notice.
 */

/** Who publishes an app, and whether Localix vouches for them. */
export interface MiniAppPublisher {
  name: string
  verified: boolean
}

/**
 * Where offers come from. `local` is a folder of built apps — in development, the checkout's
 * staged `mini-apps/`, so a change is installed without a release.
 */
export interface MiniAppStoreSource {
  kind: 'local'
  root: string
  publisher: MiniAppPublisher
}

export type MiniAppJobPhase = 'queued' | 'installing' | 'done' | 'failed'

export interface MiniAppJob {
  phase: MiniAppJobPhase
  error?: string
}

export interface MiniAppStoreEntry {
  name: string
  displayName?: string
  description: string
  category?: string
  /** The version the catalog offers. */
  version?: string
  publisher: MiniAppPublisher
  /** What is on this machine, or null. */
  installed: { version?: string } | null
  /** The catalog offers a version other than the installed one. */
  update: boolean
  job?: MiniAppJob
}

interface Offer {
  manifest: Record<string, unknown>
  source: MiniAppStoreSource
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MINI_APP_MANIFEST_FILE), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createMiniAppStore(deps: {
  homeDir: string
  /** Read per call: a development checkout restages while the API runs. */
  sources: () => MiniAppStoreSource[] | Promise<MiniAppStoreSource[]>
  /** Record the app's `mini-app` notice once it is installed (the owner announces, C1). */
  announce: (name: string) => Promise<void>
}) {
  const jobs = new Map<string, MiniAppJob>()
  const listeners = new Set<() => void>()
  let queue: Promise<void> = Promise.resolve()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const setJob = (name: string, job: MiniAppJob) => {
    jobs.set(name, job)
    notify()
  }

  /** Every app the sources offer, first source wins a name. Private (authoring) apps are not offers. */
  async function offers(): Promise<Map<string, Offer>> {
    const found = new Map<string, Offer>()
    for (const source of await deps.sources()) {
      for (const folder of await listSubdirs(source.root)) {
        if (folder.startsWith('.')) continue
        const manifest = await readManifest(join(source.root, folder))
        const name = text(manifest?.name)
        if (!manifest || !name || manifest.private === true || found.has(name)) continue
        found.set(name, { manifest, source })
      }
    }
    return found
  }

  async function install(name: string): Promise<void> {
    const offer = (await offers()).get(name)
    setJob(name, { phase: 'installing' })
    try {
      if (!offer) throw new Error(`No catalog offers a mini app named "${name}"`)
      await installBundledMiniApp(offer.source.root, deps.homeDir, name)
      await deps.announce(name)
      setJob(name, { phase: 'done' })
    } catch (error) {
      setJob(name, { phase: 'failed', error: errorMessage(error) })
    }
  }

  return {
    async list(): Promise<MiniAppStoreEntry[]> {
      const installRoot = join(deps.homeDir, MINI_APPS_SUBDIR)
      const entries = await Promise.all(
        [...(await offers())].map(async ([name, { manifest, source }]) => {
          const installed = await readManifest(join(installRoot, name))
          const version = text(manifest.version)
          const installedVersion = text(installed?.version)
          const job = jobs.get(name)
          return {
            name,
            ...(text(manifest.displayName) ? { displayName: text(manifest.displayName) } : {}),
            description: text(manifest.description) ?? '',
            ...(text(manifest.category) ? { category: text(manifest.category) } : {}),
            ...(version ? { version } : {}),
            publisher: source.publisher,
            installed: installed ? (installedVersion ? { version: installedVersion } : {}) : null,
            update: Boolean(installed && version && installedVersion !== version),
            ...(job ? { job } : {}),
          } satisfies MiniAppStoreEntry
        }),
      )
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },

    /** Queue an install; it runs after the ones before it. Resolves once queued. */
    async install(name: string): Promise<void> {
      if (jobs.get(name)?.phase === 'queued' || jobs.get(name)?.phase === 'installing') return
      setJob(name, { phase: 'queued' })
      queue = queue.then(() => install(name))
    },

    /** Resolves when every queued install has finished (tests, shutdown). */
    settled: () => queue,

    jobs: (): ReadonlyMap<string, MiniAppJob> => jobs,

    /** Hear every move of a job; returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type MiniAppStore = ReturnType<typeof createMiniAppStore>

/**
 * The sources a host offers by default: the staged first-party apps when there are any — the
 * checkout's `mini-apps/` in development — published by Localix. The hosted catalog joins here.
 */
export async function defaultMiniAppStoreSources(): Promise<MiniAppStoreSource[]> {
  const staged = await bundledMiniAppsSyncRoot()
  return staged
    ? [{ kind: 'local', root: staged, publisher: { name: 'Localix', verified: true } }]
    : []
}

import { basename } from 'node:path'
import type { CodeGraph } from '../graph/code-graph'
import { buildGraph, type GraphStats } from '../graph/build'
import { readProjectConfig } from '../graph/modules/config'
import { EXTRACTOR_VERSION } from '../extract'
import type { FileExtraction } from '../extract/types'
import { openExtractionCache, type CachedFile, type ExtractionCache } from './cache'
import { discoverFiles } from './discover'
import { refreshExtractions, yieldToLoop } from './refresh'

/**
 * One project's graph and the single job that keeps it current.
 *
 * There is exactly one refresh in flight per project: a view poll, a tool call and a reindex click
 * that arrive together share it instead of parsing the tree three times. A refresh that finds the
 * project unreadable keeps the previous graph — a transient error must not publish an empty map
 * over a good one.
 */
export type IndexPhase = 'discovering' | 'parsing' | 'linking'

export interface IndexStatus {
  state: 'empty' | 'indexing' | 'ready' | 'failed'
  phase?: IndexPhase
  progress?: { done: number; total: number }
  error?: string
  /** Increments with every published graph. */
  revision: number
  builtAt?: string
  omitted: number
}

export interface PublishedGraph {
  graph: CodeGraph
  stats: GraphStats
  revision: number
  builtAt: string
  omitted: number
}

export class ProjectIndex {
  private published: PublishedGraph | null = null
  private files: Map<string, CachedFile> | null = null
  private configSignature = ''
  private running: Promise<PublishedGraph | null> | null = null
  private status: IndexStatus = { state: 'empty', revision: 0, omitted: 0 }
  private checkedAt = 0
  private cache: ExtractionCache | null = null
  /** Files changed while a refresh was already walking: it may have passed them, so run again. */
  private stale = false
  private readonly listeners = new Set<(status: IndexStatus) => void>()
  private readonly progressListeners = new Set<(status: IndexStatus) => void>()

  constructor(
    readonly root: string,
    private readonly cacheDir: string,
  ) {}

  get current(): PublishedGraph | null {
    return this.published
  }

  /** The content hash the index last read for a file: how a code card knows its text moved on. */
  cachedHash(path: string): string | undefined {
    return this.files?.get(path)?.hash
  }

  snapshot(): IndexStatus {
    return { ...this.status }
  }

  /**
   * Start a freshness check when the last one is older than `maxAgeMs` (or none has run), and
   * return without waiting. The caller shows what is published now; the next read shows the rest.
   */
  touch(maxAgeMs: number): void {
    if (this.running || Date.now() - this.checkedAt < maxAgeMs) return
    void this.refresh()
  }

  /** The graph once the running (or a new) refresh settles, or the current one after `timeoutMs`. */
  async ready(timeoutMs: number, maxAgeMs = 5000): Promise<PublishedGraph | null> {
    this.touch(maxAgeMs)
    const running = this.running
    if (!running) return this.published
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    return (await Promise.race([running, timeout])) ?? this.published
  }

  refresh(): Promise<PublishedGraph | null> {
    this.running ??= this.run().finally(() => {
      this.running = null
      for (const listener of this.listeners) listener(this.snapshot())
      if (this.stale) {
        this.stale = false
        void this.refresh()
      }
    })
    return this.running
  }

  /**
   * Files under the project changed on disk (the workspace watcher said so). Joining the refresh
   * already in flight would lose the change whenever its walk had passed that directory, and the
   * map would keep the old file until the next backstop check — so a change during a refresh
   * queues exactly one more.
   */
  changed(): void {
    if (this.running) this.stale = true
    else void this.refresh()
  }

  /** Hear every finished refresh — a new revision, or the same one confirmed — with its status. */
  subscribe(listener: (status: IndexStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Hear a running refresh move: each phase, and each parsed file — a caller paces itself. */
  watchProgress(listener: (status: IndexStatus) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  close(): void {
    this.cache?.close()
    this.cache = null
    this.listeners.clear()
    this.progressListeners.clear()
  }

  private async run(): Promise<PublishedGraph | null> {
    const startedAt = Date.now()
    try {
      this.setPhase('discovering')
      this.cache ??= openExtractionCache(this.cacheDir, EXTRACTOR_VERSION)
      this.files ??= this.cache.load()
      const discovery = await discoverFiles(this.root)
      if (discovery.files.length === 0 && this.files.size > 0) {
        throw new Error('The project could not be read; the previous map is kept.')
      }
      this.setPhase('parsing', { done: 0, total: discovery.files.length })
      const refreshed = await refreshExtractions({
        root: this.root,
        discovered: discovery.files,
        cached: this.files,
        onProgress: (done, total) => this.setPhase('parsing', { done, total }),
      })
      this.cache.write(refreshed.changed, refreshed.removed)
      this.files = refreshed.files
      const signature = discovery.configs.map((c) => `${c.path}:${c.size}:${c.mtimeMs}`).join('|')
      // Nothing parsed and nothing removed means only stats were refreshed: every extraction the
      // graph was built from is the one it would be built from now.
      const unchanged =
        this.published &&
        refreshed.parsed === 0 &&
        refreshed.removed.length === 0 &&
        signature === this.configSignature &&
        discovery.omitted === this.published.omitted
      if (unchanged && this.published) {
        this.status = this.readyStatus(this.published)
        return this.published
      }
      this.setPhase('linking')
      await yieldToLoop()
      const config = await readProjectConfig(
        this.root,
        discovery.configs.map((c) => c.path),
      )
      const extractions = new Map<string, FileExtraction>()
      for (const [path, file] of this.files)
        if (file.extraction) extractions.set(path, file.extraction)
      const { graph, stats } = buildGraph({ rootName: basename(this.root), extractions, config })
      this.configSignature = signature
      this.published = {
        graph,
        stats,
        revision: this.status.revision + 1,
        builtAt: new Date().toISOString(),
        omitted: discovery.omitted,
      }
      this.status = this.readyStatus(this.published)
      return this.published
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Indexing failed.'
      this.status = this.published
        ? { ...this.readyStatus(this.published), error: message }
        : { state: 'failed', revision: 0, omitted: 0, error: message }
      return this.published
    } finally {
      this.checkedAt = startedAt
    }
  }

  private readyStatus(published: PublishedGraph): IndexStatus {
    return {
      state: 'ready',
      revision: published.revision,
      builtAt: published.builtAt,
      omitted: published.omitted,
    }
  }

  private setPhase(phase: IndexPhase, progress?: { done: number; total: number }) {
    const { revision, builtAt, omitted } = this.status
    this.status = {
      state: 'indexing',
      phase,
      revision,
      omitted,
      ...(builtAt ? { builtAt } : {}),
      ...(progress ? { progress } : {}),
    }
    for (const listener of this.progressListeners) listener(this.snapshot())
  }
}

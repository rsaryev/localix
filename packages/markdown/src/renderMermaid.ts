import { createBoundedCache } from '@localixai/kit/lib'
import { loadOnce } from '@localixai/kit/lib'
import type { MermaidLook } from './mermaidLook'
import { normalizeMermaidSvg } from './normalizeMermaidSvg'

/**
 * The slice of the Mermaid API a diagram render needs. Narrowed so the renderer below can be
 * driven by a stub in tests: Mermaid lays out through `getBBox`, which no DOM test runner has.
 */
export interface MermaidEngine {
  initialize(config: Record<string, unknown>): void
  parse(text: string): Promise<unknown>
  render(id: string, text: string): Promise<{ svg: string }>
}

export interface MermaidRenderer {
  /** The finished SVG when this source was already drawn in this look, else undefined. */
  peek(source: string, look: MermaidLook): string | undefined
  /** Identical requests share one layout; aborting releases only this caller. */
  render(source: string, look: MermaidLook, signal?: AbortSignal): Promise<string>
}

/** Drawn diagrams kept per session, and their total SVG size (characters) — a big ER diagram
 *  is hundreds of kilobytes, so the count alone would not bound the heap. */
const CACHE_MAX_ENTRIES = 64
const CACHE_MAX_CHARACTERS = 8_000_000

/**
 * One render at a time, remembered by source and look.
 *
 * Mermaid keeps its configuration and its scratch DOM node in module state, so two renders in
 * flight overwrite each other's colours and ids — the second diagram of a message came out in
 * the first one's palette, or not at all. Renders therefore run through one queue (the shape
 * streamdown's Mermaid block uses for the same reason). Unmounted transcript rows used to leave
 * every queued layout running; requests now share a job and release it on unmount, dropping an
 * unwanted queued job before it loads or lays out. The cache answers the other
 * defect: the virtualized transcript unmounts rows on scroll, and re-laying a diagram out on
 * every pass is visible jank. The look is part of the key because its colours are baked into
 * the SVG.
 */
export function createMermaidRenderer(load: () => Promise<MermaidEngine>): MermaidRenderer {
  const cache = createBoundedCache<string, string>({
    maxEntries: CACHE_MAX_ENTRIES,
    maxWeight: CACHE_MAX_CHARACTERS,
    weigh: (svg, key) => key.length + svg.length,
  })
  // A failed fetch of the Mermaid chunk is retried by the next diagram, not remembered.
  const engine = loadOnce(load)
  interface Consumer {
    resolve(svg: string): void
    reject(error: unknown): void
    dispose(): void
  }
  interface Job {
    key: string
    source: string
    look: MermaidLook
    consumers: Set<Consumer>
    started: boolean
  }
  const pending = new Map<string, Job>()
  const queue: Job[] = []
  let running = false
  let sequence = 0
  const keyOf = (source: string, look: MermaidLook) => `${look.key}\0${source}`
  const aborted = () => new DOMException('Diagram render cancelled', 'AbortError')

  const draw = async (job: Job): Promise<string> => {
    const mermaid = await engine()
    // Loading the shared chunk cannot be cancelled, but a departed row needs no parse or layout.
    if (job.consumers.size === 0) throw aborted()
    mermaid.initialize({
      ...job.look.config,
      startOnLoad: false,
      // Labels are model-authored text: strict makes Mermaid sanitize them and drop click
      // handlers, so a diagram cannot carry script into the transcript.
      securityLevel: 'strict',
      // Without this a syntax error leaves Mermaid's "bomb" SVG appended to <body>.
      suppressErrorRendering: true,
    })
    // `parse` throws a readable error before `render` touches the DOM.
    await mermaid.parse(job.source)
    if (job.consumers.size === 0) throw aborted()
    sequence += 1
    const { svg } = await mermaid.render(`lx-mermaid-${sequence}`, job.source)
    return job.consumers.size === 0 ? svg : normalizeMermaidSvg(svg)
  }

  const drain = async () => {
    if (running) return
    running = true
    try {
      while (queue.length > 0) {
        const job = queue.shift()!
        job.started = true
        try {
          const svg = await draw(job)
          if (job.consumers.size > 0) cache.set(job.key, svg)
          for (const consumer of job.consumers) consumer.resolve(svg)
        } catch (error) {
          // A failed or abandoned diagram must not poison the next job.
          for (const consumer of job.consumers) consumer.reject(error)
        } finally {
          for (const consumer of job.consumers) consumer.dispose()
          job.consumers.clear()
          pending.delete(job.key)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    peek: (source, look) => cache.get(keyOf(source, look)),
    render(source, look, signal) {
      if (signal?.aborted) return Promise.reject(aborted())
      const key = keyOf(source, look)
      const hit = cache.get(key)
      if (hit !== undefined) return Promise.resolve(hit)
      let job = pending.get(key)
      if (!job) {
        job = { key, source, look, consumers: new Set(), started: false }
        pending.set(key, job)
        queue.push(job)
      }
      const requested = job
      const result = new Promise<string>((resolve, reject) => {
        const cancel = () => {
          consumer.dispose()
          requested.consumers.delete(consumer)
          reject(aborted())
          if (!requested.started && requested.consumers.size === 0) {
            queue.splice(queue.indexOf(requested), 1)
            pending.delete(key)
          }
        }
        const consumer: Consumer = {
          resolve,
          reject,
          dispose: () => signal?.removeEventListener('abort', cancel),
        }
        requested.consumers.add(consumer)
        signal?.addEventListener('abort', cancel, { once: true })
      })
      void drain()
      return result
    },
  }
}

/** The app's renderer: Mermaid (~1MB) is fetched the first time a message contains a diagram. */
export const mermaidRenderer = createMermaidRenderer(() =>
  import('mermaid').then((module) => module.default as unknown as MermaidEngine),
)

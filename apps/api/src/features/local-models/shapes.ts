/**
 * Model shapes for the catalog, read from each model's header on Hugging Face and kept for good:
 * a repository at a pinned commit never changes, so its shape is fetched once (a few hundred kilobytes)
 * and stored in `shapes-cache.json`. Reads are cheap and synchronous; fetches run a few at a time
 * in the background, and a model without its shape yet is planned from its size meanwhile.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LocalModelSpec } from './contracts'
import { fetchShape, type ModelShape } from './gguf-header'

const PARALLEL = 4
/** Bumped when shapes were read wrongly (from a draft head): older files are dropped. */
const VERSION = 2

/** Every variant of a repository at one commit shares its architecture: one shape per commit. */
const keyOf = (spec: LocalModelSpec) => `${spec.repo}@${spec.revision}`

export function createShapeCache(deps: {
  root: string
  fetch?: (url: string) => Promise<ModelShape | null>
}) {
  const file = path.join(deps.root, 'shapes-cache.json')
  const fetchOne = deps.fetch ?? ((url: string) => fetchShape(url))
  const shapes = new Map<string, ModelShape | null>()
  const inFlight = new Map<string, Promise<void>>()
  let restored: Promise<void> | null = null
  let dirty = false

  function restore() {
    restored ??= readFile(file, 'utf8').then(
      (raw) => {
        const parsed = JSON.parse(raw) as {
          version?: number
          shapes?: Record<string, ModelShape | null>
        }
        if (parsed.version !== VERSION) return
        for (const [k, v] of Object.entries(parsed.shapes ?? {})) shapes.set(k, v)
      },
      () => {},
    )
    return restored
  }

  async function persist() {
    if (!dirty) return
    dirty = false
    await mkdir(deps.root, { recursive: true })
    await writeFile(file, JSON.stringify({ version: VERSION, shapes: Object.fromEntries(shapes) }))
  }

  function load(spec: LocalModelSpec): Promise<void> {
    const key = keyOf(spec)
    const weights = spec.files.find((f) => f.role === 'weights')
    if (!weights || shapes.has(key)) return Promise.resolve()
    const running = inFlight.get(key)
    if (running) return running
    const job = fetchOne(weights.url)
      .then((shape) => {
        shapes.set(key, shape)
        dirty = true
      })
      // Unreachable now: tried again the next time the catalog is read.
      .catch(() => {})
      .finally(() => inFlight.delete(key))
    inFlight.set(key, job)
    return job
  }

  return {
    restore,
    /** The shape when known; undefined while it has not been fetched. */
    get: (spec: LocalModelSpec): ModelShape | null | undefined => shapes.get(keyOf(spec)),
    /** Fetch the shapes not known yet, a few at a time. Resolves when all have settled. */
    async ensure(specs: readonly LocalModelSpec[]): Promise<void> {
      await restore()
      const seen = new Set<string>()
      const queue = specs.filter((s) => {
        const key = keyOf(s)
        if (shapes.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      const workers = Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        for (let spec = queue.shift(); spec; spec = queue.shift()) await load(spec)
      })
      await Promise.all(workers)
      await persist().catch(() => {})
    },
  }
}

export type ShapeCache = ReturnType<typeof createShapeCache>

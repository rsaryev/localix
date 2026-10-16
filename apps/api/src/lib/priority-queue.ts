/**
 * Generic, domain-agnostic priority queue.
 *
 * Ordering is "event-loop style": items carry a numeric `priority` where a
 * LOWER number means HIGHER priority (drains first), and items of the same
 * priority preserve FIFO insertion order. The consumer drains a whole priority
 * BAND at a time ({@link PriorityQueue.takeTopBand}) — i.e. it takes every item
 * at the current highest priority, processes them, and only reaches the next
 * band once the top one is empty (mirroring how a macro/microtask split lets
 * the loop finish the high-priority queue before touching the rest).
 *
 * It is deliberately a plain inspectable data structure — NOT a promise pool
 * like `p-queue` — because callers need to LIST pending items, REMOVE a
 * specific one by id, and rebuild the queue from persisted state. Those three
 * are exactly what an execution-pool queue cannot express.
 *
 * Pure (no I/O, no clock, no crypto): ids come from a monotonic per-queue
 * counter so behaviour is fully deterministic and unit-testable. Anything
 * needing wall-clock metadata stamps it onto the stored value `T`.
 */

export interface QueueItem<T> {
  /** Stable id, unique within this queue's lifetime — used to remove the item. */
  id: string
  /** Lower drains first; ties break FIFO by insertion order. */
  priority: number
  value: T
}

export interface PriorityQueue<T> {
  enqueue(value: T, opts?: { priority?: number; id?: string }): QueueItem<T>
  /** Change priority without resetting FIFO age. */
  setPriority(id: string, priority: number): boolean
  /** Replace a pending payload; execution and persistence belong to the host. */
  update(id: string, value: T): boolean
  take(): QueueItem<T> | undefined
  /**
   * Remove and return every item in the highest-priority band (lowest number),
   * in FIFO order. Returns `[]` when empty. This is the event-loop drain step:
   * the next call only sees lower-priority items once this band is exhausted.
   */
  takeTopBand(): QueueItem<T>[]
  /** The next item that would be taken, without removing it. */
  peek(): QueueItem<T> | undefined
  /** Remove a specific item by id. Returns true if it was present. */
  remove(id: string): boolean
  /** All pending items in drain order (priority then FIFO). */
  list(): QueueItem<T>[]
  size(): number
  clear(): void
}

const DEFAULT_PRIORITY = 0

export function createPriorityQueue<T>(): PriorityQueue<T> {
  // Kept in stable insertion order; ordering by priority is derived on read so
  // a `remove` can never corrupt FIFO ties. `seq` makes every id unique.
  const items: Array<QueueItem<T> & { seq: number }> = []
  let seq = 0

  /** Index of the first item in the highest-priority band, or -1 if empty. */
  const topPriority = (): number | null => {
    if (items.length === 0) return null
    let min = items[0]!.priority
    for (const it of items) if (it.priority < min) min = it.priority
    return min
  }

  return {
    enqueue(value, opts) {
      if (opts?.id !== undefined && items.some((item) => item.id === opts.id)) {
        throw new Error(`Duplicate queue item: ${opts.id}`)
      }
      if (!Number.isFinite(opts?.priority ?? DEFAULT_PRIORITY)) throw new Error('Invalid priority')
      while (items.some((item) => item.id === `q${seq}`)) seq += 1
      const item = {
        id: opts?.id ?? `q${seq}`,
        priority: opts?.priority ?? DEFAULT_PRIORITY,
        value,
        seq,
      }
      seq += 1
      items.push(item)
      return { id: item.id, priority: item.priority, value: item.value }
    },

    setPriority(id, priority) {
      if (!Number.isFinite(priority)) throw new Error('Invalid priority')
      const item = items.find((entry) => entry.id === id)
      if (!item) return false
      item.priority = priority
      return true
    },

    update(id, value) {
      const item = items.find((entry) => entry.id === id)
      if (!item) return false
      item.value = value
      return true
    },

    take() {
      const min = topPriority()
      const index = items.findIndex((item) => item.priority === min)
      if (index < 0) return undefined
      const item = items.splice(index, 1)[0]!
      return { id: item.id, priority: item.priority, value: item.value }
    },

    takeTopBand() {
      const min = topPriority()
      if (min === null) return []
      const taken: QueueItem<T>[] = []
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]!.priority === min) {
          taken.unshift({ id: items[i]!.id, priority: items[i]!.priority, value: items[i]!.value })
          items.splice(i, 1)
        }
      }
      return taken
    },

    peek() {
      const min = topPriority()
      if (min === null) return undefined
      // FIFO within the band: insertion order is array order, so the first
      // matching item is the oldest.
      const it = items.find((x) => x.priority === min)!
      return { id: it.id, priority: it.priority, value: it.value }
    },

    remove(id) {
      const idx = items.findIndex((x) => x.id === id)
      if (idx === -1) return false
      items.splice(idx, 1)
      return true
    },

    list() {
      // Priority asc (lower first), FIFO within a band via the seq tiebreak.
      return [...items]
        .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
        .map((it) => ({ id: it.id, priority: it.priority, value: it.value }))
    },

    size() {
      return items.length
    },

    clear() {
      items.length = 0
    },
  }
}

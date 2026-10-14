interface Entry {
  generation: number
  blocked: number
  readers: number
}

/** Runtime-owned admission tickets invalidate preparation that overlapped teardown. */
export class RunAdmission {
  private readonly entries = new Map<string, Entry>()

  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { generation: 0, blocked: 0, readers: 0 }
      this.entries.set(id, entry)
    }
    return entry
  }

  private prune(id: string, entry: Entry) {
    if (!entry.blocked && !entry.readers) this.entries.delete(id)
  }

  enter(id: string) {
    const entry = this.entry(id)
    if (entry.blocked) throw new Error(`Session ${id} is being deleted`)
    const generation = entry.generation
    entry.readers += 1
    let released = false
    return {
      assertValid: () => {
        if (released || entry.blocked || entry.generation !== generation)
          throw new Error(`Session ${id} admission was revoked`)
      },
      release: () => {
        if (released) return
        released = true
        entry.readers -= 1
        this.prune(id, entry)
      },
    }
  }

  async quiesce<T>(ids: readonly string[], operation: () => Promise<T>): Promise<T> {
    const entries = [...new Set(ids)].map((id) => {
      const entry = this.entry(id)
      entry.generation += 1
      entry.blocked += 1
      return { id, entry }
    })
    try {
      return await operation()
    } finally {
      for (const { id, entry } of entries) {
        entry.blocked -= 1
        this.prune(id, entry)
      }
    }
  }
}

const admissions = new WeakMap<object, RunAdmission>()
export function runtimeRunAdmission(runtimeState: object): RunAdmission {
  let admission = admissions.get(runtimeState)
  if (!admission) {
    admission = new RunAdmission()
    admissions.set(runtimeState, admission)
  }
  return admission
}

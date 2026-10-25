/**
 * Which agent file is which identity.
 *
 * Claude Code names an agent by (scope, name) and has no stable id; Localix needs one that
 * survives a rename, because rules, seats and history are keyed by it (P10). A binding row ties an
 * id to what was last seen of its definition. `planBindings` compares the rows with a fresh scan
 * and says what to write; it touches nothing, so the rules below are tested without a clock or a
 * disk. The grace window is 30 s: a file that vanishes and comes back (a git checkout, a sync
 * tool) keeps its id and its Access.
 */

/** A definition's group: its project ('' outside one) and where it came from. */
export interface BindingGroup {
  projectId: string
  /** `user`, `project`, `managed` or `plugin:<plugin>`. */
  source: string
}

export interface BoundRow extends BindingGroup {
  id: string
  name: string
  /** '' for a plugin agent. */
  path: string
  bodyHash: string
  missingSince?: string
}

export interface FoundAgent extends BindingGroup {
  name: string
  path: string
  bodyHash: string
}

export const GRACE_MS = 30_000

export const groupKey = (group: BindingGroup): string => `${group.projectId}\u0000${group.source}`

export interface BindingPlan {
  /** A definition with no row: it gets a fresh id. */
  create: Array<{ found: FoundAgent; id: string }>
  /** A row whose definition moved, changed, was renamed or came back. */
  update: Array<{ row: BoundRow; found: FoundAgent; renamed: boolean }>
  /** A row whose definition is gone: it leaves every list now and is purged after the grace. */
  missing: BoundRow[]
  /** A row past its grace, or one whose source is gone for good. */
  purge: BoundRow[]
  /** The id of every definition found, for the catalog read. */
  ids: Map<FoundAgent, string>
}

/**
 * `scanned` are the groups whose folder was read this time; a row outside them is left alone (a
 * disabled plugin, a project whose folder is missing). `gone` are groups that no longer exist (an
 * uninstalled plugin, a deleted project): their rows are purged at once.
 */
export function planBindings(input: {
  rows: readonly BoundRow[]
  found: readonly FoundAgent[]
  scanned: ReadonlySet<string>
  gone: ReadonlySet<string>
  now: number
  graceMs?: number
  newId: () => string
}): BindingPlan {
  const plan: BindingPlan = { create: [], update: [], missing: [], purge: [], ids: new Map() }
  const grace = input.graceMs ?? GRACE_MS
  const rowsOf = (key: string) => input.rows.filter((row) => groupKey(row) === key)
  for (const key of input.gone) plan.purge.push(...rowsOf(key))

  for (const key of input.scanned) {
    const rows = new Set(rowsOf(key))
    let items = input.found.filter((item) => groupKey(item) === key)
    const pair = (row: BoundRow, item: FoundAgent) => {
      rows.delete(row)
      items = items.filter((candidate) => candidate !== item)
      plan.ids.set(item, row.id)
      const renamed = row.name !== item.name
      if (
        renamed ||
        row.path !== item.path ||
        row.bodyHash !== item.bodyHash ||
        row.missingSince !== undefined
      )
        plan.update.push({ row, found: item, renamed })
    }
    const takeFirst = (pick: (item: FoundAgent) => BoundRow | undefined) => {
      for (const item of items) {
        const row = pick(item)
        if (row) pair(row, item)
      }
    }
    // The same file is the same agent, whatever its name became.
    takeFirst((item) => (item.path ? [...rows].find((row) => row.path === item.path) : undefined))
    // A file that moved keeps its name; a plugin's agents are matched by name alone.
    takeFirst((item) => [...rows].find((row) => row.name === item.name))
    // A new path and a new name with the same body is a rename, when nothing else claims it.
    takeFirst((item) => {
      if (!item.bodyHash) return undefined
      const twins = items.filter((other) => other.bodyHash === item.bodyHash)
      const same = [...rows].filter((row) => row.bodyHash === item.bodyHash)
      return twins.length === 1 && same.length === 1 ? same[0] : undefined
    })
    for (const item of items) {
      const id = input.newId()
      plan.create.push({ found: item, id })
      plan.ids.set(item, id)
    }
    for (const row of rows) {
      if (row.missingSince === undefined) plan.missing.push(row)
      else if (input.now - Date.parse(row.missingSince) >= grace) plan.purge.push(row)
    }
  }
  return plan
}

/** The next moment a missing row can be purged, or null when none waits. */
export function nextPurgeAt(rows: readonly BoundRow[], graceMs = GRACE_MS): number | null {
  const due = rows.flatMap((row) =>
    row.missingSince === undefined ? [] : [Date.parse(row.missingSince) + graceMs],
  )
  return due.length > 0 ? Math.min(...due) : null
}

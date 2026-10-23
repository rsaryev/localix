/**
 * Pure lane/rail assignment for the commit-graph visualization,
 * computed client-side from an ordered commit list (newest first) whose
 * commits carry their parent hashes. NO React, NO DOM — a plain data transform so
 * it is trivially unit-testable and reusable.
 *
 * The output is a per-row description of where the commit's node sits (its lane)
 * and the line SEGMENTS to stroke through that row, expressed in lane-index space
 * (x = lane, the row's top edge = y0, its node = ymid, its bottom edge = y1). The
 * renderer maps lane index → pixels and node/through kinds → SVG paths.
 *
 * Lane count is capped (`MAX_LANES`) so a pathological history can never blow the
 * rail width out; overflow lanes collapse onto the last lane (a graceful merge,
 * not a crash). A parent that never appears later in the window simply dangles off
 * the bottom of its row — that is a real off-window parent, drawn as a line to the
 * bottom edge, exactly as gitk shows a truncated history.
 */

/** Hard cap on rail lanes. Overflow lanes collapse onto the last one. */
export const MAX_LANES = 8

/**
 * One stroke through a row, in lane-index space.
 *  - `through`: a lane passing straight through (top → bottom), unrelated to this node.
 *  - `to`:      a child above merging DOWN into this commit's node (top lane → node).
 *  - `from`:    this commit's node branching to a parent BELOW (node → bottom lane).
 */
export interface LaneEdge {
  top: number
  bottom: number
  kind: 'through' | 'to' | 'from'
}

export interface CommitLaneRow {
  hash: string
  /** Lane index the commit's node sits in. */
  lane: number
  /** Lanes to reserve for this row (max index touched + 1), capped at `MAX_LANES`. */
  width: number
  /** Whether this commit is a merge (2+ parents) — the renderer may emphasize it. */
  merge: boolean
  edges: LaneEdge[]
}

interface CommitLike {
  hash: string
  parents?: string[]
}

/** Clamp a lane index into the capped rail so overflow collapses onto the last lane. */
function clampLane(i: number): number {
  return i < MAX_LANES ? i : MAX_LANES - 1
}

/** First empty (null) slot in the active-lane array, or its length to append. */
function firstFree(active: (string | null)[]): number {
  const i = active.indexOf(null)
  return i === -1 ? active.length : i
}

/**
 * Assign lanes + edges to an ordered (newest-first) commit list.
 *
 * The algorithm walks a set of "active lanes", each waiting for the next commit
 * (by hash) that should appear in it. For each commit: it occupies the leftmost
 * lane already waiting for it (or a fresh lane if it's a tip / off-window child);
 * its first parent inherits that lane, extra parents open (or merge into) further
 * lanes, and any duplicate lanes that were waiting for it are freed.
 */
export function assignCommitLanes(commits: CommitLike[]): CommitLaneRow[] {
  const active: (string | null)[] = []
  const rows: CommitLaneRow[] = []

  for (const c of commits) {
    // Snapshot of lanes at the TOP of this row (incoming state).
    const incoming = active.slice()

    // Lanes already waiting for this commit (its children point here).
    const waiting: number[] = []
    for (let i = 0; i < active.length; i++) if (active[i] === c.hash) waiting.push(i)

    let lane: number
    if (waiting.length > 0) {
      lane = waiting[0]!
      // Free the duplicate lanes (multiple children converging) — they merge in.
      for (let k = 1; k < waiting.length; k++) active[waiting[k]!] = null
    } else {
      // A tip or an off-window child: start a fresh lane.
      lane = firstFree(active)
      if (lane >= active.length) active.push(null)
    }

    const parents = c.parents ?? []
    // First parent inherits this commit's lane; no parents → lane closes.
    active[lane] = parents[0] ?? null
    // Additional parents: merge into an existing waiting lane, else open a new one.
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p]!
      if (active.includes(ph)) continue
      const slot = firstFree(active)
      if (slot >= active.length) active.push(null)
      active[slot] = ph
    }

    const outgoing = active.slice()
    const cLane = clampLane(lane)
    const edges: LaneEdge[] = []

    // Pass-through lanes: present at top with a hash that isn't this commit, and
    // still present at the same index below → a straight vertical line.
    for (let i = 0; i < incoming.length; i++) {
      const h = incoming[i]
      if (!h || h === c.hash) continue
      // The lane keeps its index (we never compact passthrough lanes), so it
      // continues iff it's still that hash below.
      if (outgoing[i] === h)
        edges.push({ top: clampLane(i), bottom: clampLane(i), kind: 'through' })
    }

    // Incoming edges: each waiting child lane merges DOWN into this node.
    for (const w of waiting) {
      if (w === lane) continue
      edges.push({ top: clampLane(w), bottom: cLane, kind: 'to' })
    }

    // Outgoing edges: this node branches to each parent's lane below. The FIRST
    // parent always inherits this commit's own lane — resolve it positionally,
    // not via indexOf: when another lane is also waiting for the same parent
    // (two branches converging), indexOf would find that other lane and draw the
    // join a row early, leaving a discontinuous diagonal. The real join renders
    // on the parent's own row as a `to` edge.
    for (let p = 0; p < parents.length; p++) {
      const pLane = p === 0 ? lane : outgoing.indexOf(parents[p]!)
      if (pLane === -1) continue
      edges.push({ top: cLane, bottom: clampLane(pLane), kind: 'from' })
    }

    let width = 0
    for (const e of edges) width = Math.max(width, e.top + 1, e.bottom + 1)
    width = Math.max(width, cLane + 1)

    rows.push({
      hash: c.hash,
      lane: cLane,
      width: Math.min(width, MAX_LANES),
      merge: parents.length > 1,
      edges,
    })

    // Compaction: once the right-most lanes have closed (freed), drop them so the
    // active array does not grow unboundedly across a long history of open/close
    // branches. This is OUTPUT-EQUIVALENT — `firstFree` already returns "first
    // interior null, else length", so a freed trailing lane and a popped trailing
    // lane yield the same next-free index — and per-row `width` is derived from
    // edges (only genuinely-active lanes emit `through` strokes), not from
    // `active.length`, so widths already shrink back on their own. Trimming keeps
    // the scan bounded without shifting any live lane's index mid-flight.
    while (active.length > 0 && active[active.length - 1] === null) active.pop()
  }

  return rows
}

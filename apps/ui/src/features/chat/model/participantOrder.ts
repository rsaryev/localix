/**
 * THE ORDER THE PARTICIPANTS STRIP DRAWS ITS NAMES IN.
 *
 * The strip kept roster order and scrolls sideways, so with six participants the one speaking
 * could sit at the right edge or past it — the person watched a still row while the turn that
 * was costing them ran off screen. The speaker belongs at the start, where the eye lands.
 *
 * The order is DERIVED from what is already known — the roster, the live floor and the order on
 * screen a moment ago — and never stored: the server owns who is speaking, and a second, persisted
 * ordering would be one more thing to reconcile with it.
 *
 * Each rule exists to keep the row from moving more than the floor did:
 * - while a round runs, the speaker comes first, then the waiting participants by their place in
 *   line, then everyone else in the order they ALREADY had — a stable rest, so a change at the
 *   front never shuffles the tail;
 * - when the round ends, the order stays. Snapping back to roster order would move every chip a
 *   second time per round, for no new fact;
 * - someone who joins appends at the end; someone who leaves drops out; with nothing on screen
 *   yet, the roster's own order is the start.
 */

/** Who holds the floor: the run answering now and the addressed turns queued behind it. */
export interface FloorOrder {
  speaking: string | null
  waiting: readonly string[]
}

/** Whether a round is running — someone speaking or someone queued. */
export function floorIsRunning(floor: FloorOrder | null | undefined): floor is FloorOrder {
  return Boolean(floor && (floor.speaking || floor.waiting.length > 0))
}

/**
 * The previous order carried onto the current roster: leavers dropped, joiners appended in roster
 * order, everyone else where they were.
 */
function carriedOrder(roster: readonly string[], previous: readonly string[] | null): string[] {
  if (!previous) return [...roster]
  const present = new Set(roster)
  const kept = previous.filter((id) => present.has(id))
  const known = new Set(kept)
  return [...kept, ...roster.filter((id) => !known.has(id))]
}

/**
 * The live order of `roster` (agent ids) under `floor`, starting from `previous` — the order the
 * strip rendered last, or `null` for a fresh strip. Idempotent: feeding the result back as
 * `previous` with the same inputs returns the same order, so a re-render never moves anything.
 */
export function liveParticipantOrder(
  roster: readonly string[],
  floor: FloorOrder | null | undefined,
  previous: readonly string[] | null,
): string[] {
  const base = carriedOrder(roster, previous)
  if (!floorIsRunning(floor)) return base
  const present = new Set(roster)
  const front: string[] = []
  for (const id of [floor.speaking, ...floor.waiting]) {
    if (id && present.has(id) && !front.includes(id)) front.push(id)
  }
  const fronted = new Set(front)
  return [...front, ...base.filter((id) => !fronted.has(id))]
}

/** Two orders are the same sequence of ids. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

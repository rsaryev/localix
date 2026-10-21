/**
 * WHO HOLDS THE FLOOR, as the participants strip reads it.
 *
 * The strip draws its names in roster order and never reorders them: moving the speaker to the
 * front made every chip jump at each change of speaker, several times a round. Who is speaking and
 * who waits is drawn ON the names (the beam, the place in line) instead.
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

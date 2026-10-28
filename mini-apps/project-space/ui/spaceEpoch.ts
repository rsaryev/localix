/**
 * Which board an answer belongs to, and whether it is still the one asked for.
 *
 * `useSpace` starts reads and writes that finish later. Each one remembers the epoch it began in;
 * leaving a board, or switching to another, ends the epoch, and a late answer then finds it is no
 * longer the owner's and is dropped instead of landing on a board the person has left.
 */
export class SpaceEpoch {
  private owner: string | null = null
  private generation = 0
  private read = 0

  /** The board `sessionId` is now the one on screen; everything begun before is stale. */
  begin(sessionId: string | null): void {
    this.owner = sessionId
    this.generation++
    this.read++
  }

  /** The view has been left: nothing begun so far may land. */
  end(): void {
    this.owner = null
    this.generation++
    this.read++
  }

  /** A write or step begins: the generation to hand to `holds` when it finishes. */
  mark(): number {
    return this.generation
  }

  /** A read begins: the sequence to hand to `latest` when it finishes. */
  nextRead(): number {
    return ++this.read
  }

  /** Still on `sessionId`, and no other board was opened since `generation` was marked. */
  holds(sessionId: string, generation: number): boolean {
    return this.owner === sessionId && this.generation === generation
  }

  /** Still on `sessionId`, and no newer read has begun since `sequence`. */
  latest(sessionId: string, sequence: number): boolean {
    return this.owner === sessionId && this.read === sequence
  }
}

/** Cap on retained scrollback UTF-16 code units — enough to repaint a reconnect, bounded so
 *  a long-lived session can't grow without limit. */
const SCROLLBACK_LIMIT = 256 * 1024

/** Retains PTY chunks and joins them only when a reconnect or screen snapshot reads the tail. */
export class TerminalScrollback {
  private chunks: string[] = []
  private codeUnits = 0
  private joined: string | null = ''

  /**
   * Append one PTY chunk, trimming the oldest UTF-16 code units past the cap.
   * The oldest surviving chunk is cut mid-string
   * when it straddles the boundary. A cut through a surrogate pair also drops its
   * orphaned low surrogate, so reconnect receives a valid Unicode tail.
   */
  append(data: string): void {
    this.chunks.push(data)
    this.codeUnits += data.length
    const trimmed = this.codeUnits > SCROLLBACK_LIMIT
    while (this.codeUnits > SCROLLBACK_LIMIT) {
      const oldest = this.chunks[0] as string
      const excess = this.codeUnits - SCROLLBACK_LIMIT
      if (oldest.length <= excess) {
        this.chunks.shift()
        this.codeUnits -= oldest.length
      } else {
        this.chunks[0] = oldest.slice(excess)
        this.codeUnits -= excess
      }
    }
    // A code-unit cap can bisect a supplementary character, including across chunks.
    // Drop the orphaned low surrogate too; the retained tail stays within the cap.
    const first = this.chunks[0]
    const firstCode = first?.charCodeAt(0)
    if (trimmed && firstCode !== undefined && firstCode >= 0xdc00 && firstCode <= 0xdfff) {
      if (first.length === 1) this.chunks.shift()
      else this.chunks[0] = first.slice(1)
      this.codeUnits -= 1
    }
    this.joined = null
  }

  /** The retained scrollback as one string, joined at most once per new chunk. */
  get replay(): string {
    this.joined ??= this.chunks.join('')
    return this.joined
  }
}

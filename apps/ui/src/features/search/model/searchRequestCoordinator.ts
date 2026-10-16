export interface SearchRequestTicket {
  sequence: number
  controller: AbortController
  kind: 'primary' | 'more'
}

/**
 * Small framework-free concurrency primitive for global search. It gives query
 * requests last-write-wins semantics and pagination single-flight semantics.
 */
export class SearchRequestCoordinator {
  private sequence = 0
  private primary: SearchRequestTicket | null = null
  private more: SearchRequestTicket | null = null

  invalidate(): void {
    this.sequence += 1
    this.primary?.controller.abort()
    this.more?.controller.abort()
    this.primary = null
    this.more = null
  }

  beginPrimary(): SearchRequestTicket {
    this.primary?.controller.abort()
    this.more?.controller.abort()
    this.more = null
    const ticket: SearchRequestTicket = {
      sequence: ++this.sequence,
      controller: new AbortController(),
      kind: 'primary',
    }
    this.primary = ticket
    return ticket
  }

  beginMore(): SearchRequestTicket | null {
    if (this.more) return null
    const ticket: SearchRequestTicket = {
      sequence: this.sequence,
      controller: new AbortController(),
      kind: 'more',
    }
    this.more = ticket
    return ticket
  }

  isCurrent(ticket: SearchRequestTicket): boolean {
    return ticket.sequence === this.sequence && !ticket.controller.signal.aborted
  }

  finish(ticket: SearchRequestTicket): void {
    if (this.primary === ticket) this.primary = null
    if (this.more === ticket) this.more = null
  }
}

/** Generated fork suffixes occupy the end of a title; user text elsewhere stays intact. */
const FORK_SUFFIXES = /(?:\s*\(fork(?:\s+\d+)?\))+$/i

/** A stable conversation number distinguishes sibling forks without accumulating ancestry. */
export function forkSessionTitle(title: string | null | undefined, seq: number): string {
  const base = title?.trim().replace(FORK_SUFFIXES, '').trim() || 'New Chat'
  return `${base} (fork ${seq})`
}

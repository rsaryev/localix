/** Generated fork suffixes occupy the end of a title; user text elsewhere stays intact. */
const FORK_SUFFIXES = /(?:\s*\(fork(?:\s+\d+)?\))+$/i

/** A stable conversation number distinguishes sibling forks without accumulating ancestry. */
export function forkSessionTitle(title: string | null | undefined, seq: number): string {
  const base = title?.trim().replace(FORK_SUFFIXES, '').trim() || 'New Chat'
  return `${base} (fork ${seq})`
}

/** Clean legacy repeated suffixes for display without rewriting saved conversation names. */
export function compactSessionTitle(title: string, seq?: number): string {
  const trimmed = title.trim()
  const suffix = trimmed.match(FORK_SUFFIXES)?.[0]
  if (!suffix || (suffix.match(/\(fork/gi)?.length ?? 0) < 2) return trimmed
  const base = trimmed.slice(0, -suffix.length).trim()
  return `${base || 'New Chat'} (fork${seq ? ` ${seq}` : ''})`
}

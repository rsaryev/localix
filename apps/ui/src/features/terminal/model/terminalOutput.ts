// In-memory replay survives grid keep-alive eviction without persisting terminal output to disk.
// `head` is the first live chunk: dropping the oldest output advances it instead of shifting the
// array, which re-indexed every retained chunk on each write once the buffer was full of small
// PTY writes. The dead prefix is compacted away once it outgrows the live part.
const output = new Map<string, { chunks: string[]; head: number; size: number }>()
const MAX_TERMINALS = 16
const MAX_CHARS = 256 * 1024

export function terminalOutput(id: string): string | undefined {
  const entry = output.get(id)
  return entry?.chunks.slice(entry.head).join('')
}

export function resetTerminalOutput(id: string): void {
  output.delete(id)
}

export function retainTerminalOutput(id: string, data: string): void {
  const entry = output.get(id) ?? { chunks: [], head: 0, size: 0 }
  entry.chunks.push(data)
  entry.size += data.length
  while (entry.size > MAX_CHARS && entry.chunks.length - entry.head > 1)
    entry.size -= entry.chunks[entry.head++]!.length
  if (entry.size > MAX_CHARS) {
    entry.chunks[entry.head] = entry.chunks[entry.head]!.slice(-MAX_CHARS)
    entry.size = MAX_CHARS
  }
  if (entry.head > entry.chunks.length - entry.head) {
    entry.chunks = entry.chunks.slice(entry.head)
    entry.head = 0
  }
  output.delete(id)
  output.set(id, entry)
  while (output.size > MAX_TERMINALS) output.delete(output.keys().next().value!)
}

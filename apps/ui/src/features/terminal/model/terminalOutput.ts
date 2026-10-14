// In-memory replay survives grid keep-alive eviction without persisting terminal output to disk.
const output = new Map<string, { chunks: string[]; size: number }>()
const MAX_TERMINALS = 16
const MAX_CHARS = 256 * 1024

export function terminalOutput(id: string): string | undefined {
  return output.get(id)?.chunks.join('')
}

export function resetTerminalOutput(id: string): void {
  output.delete(id)
}

export function retainTerminalOutput(id: string, data: string): void {
  const entry = output.get(id) ?? { chunks: [], size: 0 }
  entry.chunks.push(data)
  entry.size += data.length
  while (entry.size > MAX_CHARS && entry.chunks.length > 1)
    entry.size -= entry.chunks.shift()!.length
  if (entry.size > MAX_CHARS) {
    entry.chunks[0] = entry.chunks[0]!.slice(-MAX_CHARS)
    entry.size = MAX_CHARS
  }
  output.delete(id)
  output.set(id, entry)
  while (output.size > MAX_TERMINALS) output.delete(output.keys().next().value!)
}

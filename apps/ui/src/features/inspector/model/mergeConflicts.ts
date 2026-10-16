export type MergeConflictChoice = 'current' | 'incoming' | 'both'

export interface MergeConflictRegion {
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
  current: { startOffset: number; endOffset: number; startLine: number; endLine: number }
  incoming: { startOffset: number; endOffset: number; startLine: number; endLine: number }
  base?: { startOffset: number; endOffset: number; startLine: number; endLine: number }
  currentLabel: string
  incomingLabel: string
  baseLabel?: string
}

interface SourceLine {
  text: string
  start: number
  contentEnd: number
  end: number
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text[i] !== '\n') continue
    const end = i < text.length ? i + 1 : i
    const contentEnd = i > start && text[i - 1] === '\r' ? i - 1 : i
    lines.push({ text: text.slice(start, contentEnd), start, contentEnd, end })
    start = end
  }
  return lines
}

function labelAfter(text: string, marker: string): string {
  return text.slice(marker.length).trim()
}

function contentRange(lines: SourceLine[], from: number, to: number) {
  const start = lines[from]?.start ?? lines[to]?.start ?? 0
  const end = lines[to]?.start ?? start
  return {
    startOffset: start,
    endOffset: end,
    startLine: from + 1,
    endLine: Math.max(from + 1, to),
  }
}

/** Parse complete two-way and diff3 conflict blocks. Malformed marker sequences are ignored. */
export function parseMergeConflicts(text: string): MergeConflictRegion[] {
  const lines = sourceLines(text)
  const regions: MergeConflictRegion[] = []

  for (let start = 0; start < lines.length; start++) {
    if (!/^<{7}(?: .*)?$/.test(lines[start].text)) continue

    let baseMarker = -1
    let separator = -1
    let endMarker = -1
    for (let i = start + 1; i < lines.length; i++) {
      if (/^<{7}(?: .*)?$/.test(lines[i].text)) break
      if (baseMarker < 0 && /^\|{7}(?: .*)?$/.test(lines[i].text)) {
        baseMarker = i
        continue
      }
      if (/^={7}$/.test(lines[i].text)) {
        separator = i
        continue
      }
      if (separator >= 0 && /^>{7}(?: .*)?$/.test(lines[i].text)) {
        endMarker = i
        break
      }
    }
    if (separator < 0 || endMarker < 0 || (baseMarker >= 0 && baseMarker > separator)) continue

    const currentEnd = baseMarker >= 0 ? baseMarker : separator
    const current = contentRange(lines, start + 1, currentEnd)
    const incoming = contentRange(lines, separator + 1, endMarker)
    const base = baseMarker >= 0 ? contentRange(lines, baseMarker + 1, separator) : undefined

    regions.push({
      startOffset: lines[start].start,
      endOffset: lines[endMarker].end,
      startLine: start + 1,
      endLine: endMarker + 1,
      current,
      incoming,
      base,
      currentLabel: labelAfter(lines[start].text, '<<<<<<<') || 'Current',
      incomingLabel: labelAfter(lines[endMarker].text, '>>>>>>>') || 'Incoming',
      baseLabel:
        baseMarker >= 0 ? labelAfter(lines[baseMarker].text, '|||||||') || 'Base' : undefined,
    })
    start = endMarker
  }

  return regions
}

/** Replace one parsed block without normalizing its original LF/CRLF content. */
export function resolveMergeConflict(
  text: string,
  region: MergeConflictRegion,
  choice: MergeConflictChoice,
): string {
  const current = text.slice(region.current.startOffset, region.current.endOffset)
  const incoming = text.slice(region.incoming.startOffset, region.incoming.endOffset)
  const replacement =
    choice === 'current' ? current : choice === 'incoming' ? incoming : current + incoming
  return text.slice(0, region.startOffset) + replacement + text.slice(region.endOffset)
}

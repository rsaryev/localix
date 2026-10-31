import { plural } from '../../../../lib/plural'

/** Result of rendering a numbered line-range read. */
export interface LineRangeRender {
  output: string
  truncated: boolean
  /** Total byte length of the source file (not of the rendered slice). */
  bytes: number
  /** When the requested start is past EOF, a notice string is returned instead. */
  pastEnd?: boolean
}

/**
 * Render a 1-based numbered line span from a file's content, capping the output
 * at `maxBytes`. Each line is prefixed with its number so the model can line up
 * `search` hits; this is the cheap, elidable alternative to `bash cat/nl/sed`.
 *
 * A line-range read IGNORES `byte_offset` (startLine takes precedence), so on overflow
 * it advises continuing with a higher startLine — byte paging would silently
 * re-read the same span. Always emits at least the first requested line.
 */
export function renderLineRange(
  fileContent: string,
  targetPath: string,
  startLine: number,
  endLine: number | undefined,
  maxBytes: number,
): LineRangeRender {
  const lines = fileContent.split('\n')
  // A trailing newline yields a final empty split element that is NOT a real line.
  // Drop it so the reported line count and numbering match ripgrep / an editor (a
  // "…\n"-terminated file would otherwise show one phantom empty line too many).
  // Guarded by length > 1 so a genuinely empty file stays a single empty line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const total = lines.length
  const start = startLine
  if (start > total) {
    const notice = `${targetPath} has only ${plural(total, 'line')}; requested start_line=${start} is past the end.`
    return {
      output: notice,
      truncated: false,
      bytes: Buffer.byteLength(fileContent),
      pastEnd: true,
    }
  }
  const end = Math.min(Math.max(endLine ?? total, start), total)
  const width = String(end).length
  const header = `[${targetPath} lines ${start}-${end} of ${total}]\n`
  let output = header
  let outBytes = Buffer.byteLength(header)
  let last = start - 1
  for (let i = start - 1; i < end; i++) {
    const numbered = `${String(i + 1).padStart(width)}\t${lines[i]}\n`
    const nb = Buffer.byteLength(numbered)
    if (i > start - 1 && outBytes + nb > maxBytes) break
    output += numbered
    outBytes += nb
    last = i + 1
  }
  const truncated = last < end
  output = truncated
    ? `${output}[…showed lines ${start}-${last} of the requested ${start}-${end}; ${end - last} more remain. Continue with start_line=${last + 1}, or use \`Search\` to jump straight to a symbol/line.]`
    : output.replace(/\n$/, '')
  return { output, truncated, bytes: Buffer.byteLength(fileContent) }
}

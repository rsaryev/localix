import { inertLine } from '@localixai/plugin-sdk/ui/utilities'

// Console/tool output is tail-relevant (errors and results land at the end) and
// the viewer pins to the bottom, so when output is pathologically large we render
// only the last `maxChars` rather than laying out the whole thing in one <pre>.
// Display-only: the full output still lives in the model's context.
const DEFAULT_MAX_CHARS = 100_000

const EARLIER_TRUNCATED = '…earlier output truncated…\n'
const LATER_TRUNCATED = '\n…later input truncated…'

/**
 * Clamp `output` to its last `maxChars`, dropping any partial leading line and
 * prefixing a marker so it's clear earlier output was hidden. Returns the string
 * unchanged when it's already within budget.
 */
export function clampConsoleTail(output: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (output.length <= maxChars) return output
  const tail = output.slice(output.length - maxChars)
  const nl = tail.indexOf('\n')
  const clean = nl >= 0 ? tail.slice(nl + 1) : tail
  return `${EARLIER_TRUNCATED}${clean}`
}

/** Only this much of the end can hold the last line; a delta never rescans megabytes. */
const LAST_LINE_WINDOW = 4096

/**
 * The line a running command's output currently ends with, as one inert line — what its
 * collapsed row shows so live output needs no expanded console. A carriage return redraws a line
 * (progress bars), so a line reads as the text after its last one. `undefined` when there is none.
 */
export function consoleLastLine(output: string, maxChars = 160): string | undefined {
  const lines = output.slice(-LAST_LINE_WINDOW).split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const redrawn = lines[index]!.replace(/\r+$/, '').split('\r').pop() ?? ''
    const shown = inertLine(redrawn, maxChars)
    if (shown) return shown
  }
  return undefined
}

/**
 * Head-oriented counterpart for tool inputs such as a generated shell script.
 * Drops a partial trailing line and advertises that the complete source remains
 * outside the transcript projection.
 */
export function clampConsoleHead(input: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (input.length <= maxChars) return input
  const head = input.slice(0, maxChars)
  const nl = head.lastIndexOf('\n')
  const clean = nl >= 0 ? head.slice(0, nl) : head
  return `${clean}${LATER_TRUNCATED}`
}

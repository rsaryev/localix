/**
 * The bash run paths append status markers (`[exit 1]`, `[Timed out after Ns]`,
 * `[terminated (signal N)]`, `[Killed by user]`) to the END of the combined
 * output BEFORE it reaches the model-facing layer. Filters must never eat
 * those — split them off, filter the body, re-append.
 */
const TRAILING_MARKER =
  /^\[(?:exit -?\d+|Timed out after \d+s|terminated \(signal \d+\)|Killed by user|Stopped by the (?:agent|person))\]$/

export function splitTrailingMarkers(output: string): { body: string; markers: string[] } {
  const lines = output.split('\n')
  const markers: string[] = []
  while (lines.length > 0 && TRAILING_MARKER.test(lines[lines.length - 1].trim())) {
    markers.unshift(lines.pop()!.trim())
  }
  return { body: lines.join('\n'), markers }
}

/** Provenance line appended to a filtered output so the model knows what happened and how to recover. */
export function filterMarker(
  name: string,
  keptLines: number,
  totalLines: number,
  toolCallId?: string,
): string {
  const recover = toolCallId
    ? `full output: ToolOutput action="get" tool_call_id="${toolCallId}"`
    : 'full output available in the terminal panel'
  return `[${name} output filtered: kept ${keptLines} of ${totalLines} lines; ${recover}]`
}

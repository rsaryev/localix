/**
 * Interleave several containers' log streams into one chronological text block.
 *
 * A multi-container pod is the case a single-container log view cannot serve: the request
 * that the app logged and the proxy decision the sidecar logged are one story, and reading
 * them in two separate panes loses the ordering that IS the explanation.
 *
 * Merging is done HERE rather than in the UI because the API returns one stream per
 * container: the ordering rule is a data rule, and a pure module can be tested against the
 * awkward cases (a line with no timestamp, identical timestamps, a container that logged
 * nothing) instead of being discovered in a log viewer.
 */

/** One container's fetched log block. */
export interface ContainerLogStream {
  container: string
  /** Raw `readNamespacedPodLog` text, RFC3339-prefixed because we always ask for stamps. */
  lines: string
}

const RFC3339_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s/

interface Entry {
  /** Sort key: epoch millis, or `null` for a line the runtime did not stamp. */
  at: number | null
  /** Stream order, so identical timestamps keep a stable, source-grouped order. */
  stream: number
  /** Line order within its stream — never reordered relative to its own siblings. */
  index: number
  text: string
}

function splitLines(value: string): string[] {
  const trimmed = value.endsWith('\n') ? value.slice(0, -1) : value
  return trimmed ? trimmed.split(/\r?\n/) : []
}

function timestampOf(line: string): number | null {
  const match = RFC3339_PREFIX.exec(line)
  if (!match) return null
  const parsed = Date.parse(match[1]!)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Merge streams chronologically, prefixing each line with its container.
 *
 * Ordering rules, in order of precedence:
 *  1. Timestamped lines sort by timestamp.
 *  2. Equal timestamps fall back to stream order, then line order — so two containers that
 *     logged in the same millisecond stay internally ordered instead of shuffling on every
 *     poll, which would make the view flicker.
 *  3. A line with NO timestamp (a multi-line stack trace's continuation, or a runtime that
 *     wrote a bare line) inherits the position of the last stamped line in its own stream.
 *     Sorting it to the top by treating it as time zero would tear stack traces apart.
 */
export function mergeContainerLogs(streams: readonly ContainerLogStream[]): string {
  const entries: Entry[] = []
  streams.forEach((stream, streamIndex) => {
    let inherited: number | null = null
    splitLines(stream.lines).forEach((line, lineIndex) => {
      const at = timestampOf(line)
      if (at !== null) inherited = at
      entries.push({
        at: at ?? inherited,
        stream: streamIndex,
        index: lineIndex,
        text: `[${stream.container}] ${line}`,
      })
    })
  })

  entries.sort((a, b) => {
    // An unstamped line at the very START of a stream has nothing to inherit; keep it
    // ahead of stamped content from its own stream rather than dropping it to the end.
    if (a.at === null && b.at === null) return a.stream - b.stream || a.index - b.index
    if (a.at === null) return -1
    if (b.at === null) return 1
    return a.at - b.at || a.stream - b.stream || a.index - b.index
  })

  return entries.map((entry) => entry.text).join('\n')
}

/**
 * Init containers FIRST, then app containers — the order they ran in.
 *
 * Init containers are part of the pod's story and the API will serve their logs, but they
 * are in a separate spec field, so a naive read of `spec.containers` cannot see them. That
 * omission is worst exactly when it matters: a pod stuck at `Init:0/1` has no app-container
 * logs at all, and the init container's output is the whole explanation.
 */
export function podContainerNames(pod: Record<string, unknown>): string[] {
  const spec = (pod.spec ?? {}) as Record<string, unknown>
  const names = (field: unknown): string[] => {
    if (!Array.isArray(field)) return []
    const result: string[] = []
    for (const entry of field) {
      if (!entry || typeof entry !== 'object') continue
      const name = (entry as Record<string, unknown>).name
      if (typeof name === 'string' && name) result.push(name)
    }
    return result
  }
  return [...names(spec.initContainers), ...names(spec.containers)]
}

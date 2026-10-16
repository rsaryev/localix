/**
 * The `until` predicate: does ONE poll of the check command mean the wait is over?
 *
 * Pure, so the interesting half of a monitor is testable without a process, a clock or a
 * session. Everything here operates on a `MonitorSample` — what the check printed and how it
 * exited — and returns a verdict with a HUMAN detail string, because that string is what the
 * agent reads in the wake ("status=success", "temp=36.2 ≥ 35"). A bare `true` would wake the
 * agent with no evidence for why it was woken.
 *
 * Deliberately small. Anything richer belongs inside the check command itself, where `jq`,
 * `grep -c` and the user's own tools already live — a predicate language here would be a
 * second, worse shell.
 *
 * Two rules worth stating because both were chosen against an obvious alternative:
 *   - text predicates read stdout AND stderr. A check is usually a one-liner (`curl -sf …`,
 *     `gh run view`) whose failure text goes to stderr; matching stdout alone made a failing
 *     check indistinguishable from a quiet one.
 *   - a malformed regex/json_path is caught at START (`validateCondition`), not at poll time.
 *     A monitor that silently never fires is the worst failure this feature can have.
 */
import type { MonitorCondition, MonitorNumberBound } from './contracts'

/** One poll's result. */
export interface MonitorSample {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ConditionVerdict {
  satisfied: boolean
  /** Evidence, model-facing: what was compared and what was found. */
  detail: string
}

/** Combined check output — see the header on why stderr counts. */
export function sampleText(sample: MonitorSample): string {
  return [sample.stdout, sample.stderr].filter(Boolean).join('\n').trim()
}

/** First line of the sample, for compact evidence in a verdict. */
function evidence(sample: MonitorSample): string {
  const text = sampleText(sample)
  if (!text) return `no output (exit ${sample.exitCode})`
  const [first = ''] = text.split('\n')
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

/**
 * Read a dotted/bracket path out of parsed JSON. Supports `$.a.b[0]`, `a.b.0` and `[2].x`.
 * Returns `undefined` for any miss — a monitor must not crash on a shape that changed.
 */
function readJsonPath(value: unknown, path: string): unknown {
  const keys = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let current: unknown = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** The number a `number` predicate compares: a json_path value, else the first number in the text. */
function extractNumber(sample: MonitorSample, jsonPath?: string): number | undefined {
  const text = sampleText(sample)
  if (jsonPath) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return undefined
    }
    const found = readJsonPath(parsed, jsonPath)
    const numeric = typeof found === 'string' ? Number(found) : found
    return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : undefined
  }
  const match = /-?\d+(?:\.\d+)?/.exec(text)
  return match ? Number(match[0]) : undefined
}

function boundPhrase(bound: MonitorNumberBound): string {
  const parts: string[] = []
  if (bound.gte !== undefined) parts.push(`≥ ${bound.gte}`)
  if (bound.lte !== undefined) parts.push(`≤ ${bound.lte}`)
  if (bound.eq !== undefined) parts.push(`= ${bound.eq}`)
  return parts.join(' and ') || 'any value'
}

function boundHolds(value: number, bound: MonitorNumberBound): boolean {
  if (bound.gte !== undefined && !(value >= bound.gte)) return false
  if (bound.lte !== undefined && !(value <= bound.lte)) return false
  if (bound.eq !== undefined && value !== bound.eq) return false
  return true
}

/**
 * Reject a condition that can never work, at START. Returns an error message the tool hands
 * back as a tool error, or `null` when the condition is usable.
 */
export function validateCondition(when: MonitorCondition): string | null {
  switch (when.kind) {
    case 'regex':
      try {
        new RegExp(when.value)
        return null
      } catch (error) {
        return `Invalid regex: ${error instanceof Error ? error.message : String(error)}`
      }
    case 'contains':
    case 'not_contains':
      return when.value.length > 0 ? null : 'An empty string matches everything — give a value.'
    case 'number': {
      const { gte, lte, eq } = when.bound
      if (gte === undefined && lte === undefined && eq === undefined)
        return 'Give at least one of gte / lte / eq.'
      if (gte !== undefined && lte !== undefined && gte > lte)
        return `Impossible range: gte ${gte} > lte ${lte}.`
      return null
    }
    case 'exit_zero':
      return null
  }
}

/** Evaluate one poll against the predicate. */
export function evaluateCondition(sample: MonitorSample, when: MonitorCondition): ConditionVerdict {
  switch (when.kind) {
    case 'exit_zero':
      return {
        satisfied: sample.exitCode === 0,
        detail: `check exited ${sample.exitCode}${sample.exitCode === 0 ? '' : ` — ${evidence(sample)}`}`,
      }
    case 'contains': {
      const satisfied = sampleText(sample).includes(when.value)
      return {
        satisfied,
        detail: satisfied ? `matched "${when.value}": ${evidence(sample)}` : evidence(sample),
      }
    }
    case 'not_contains': {
      const satisfied = !sampleText(sample).includes(when.value)
      return {
        satisfied,
        detail: satisfied ? `"${when.value}" is gone: ${evidence(sample)}` : evidence(sample),
      }
    }
    case 'regex': {
      let re: RegExp
      try {
        re = new RegExp(when.value)
      } catch {
        // Unreachable for a validated spec; a broken regex must never read as "satisfied".
        return { satisfied: false, detail: `invalid regex ${when.value}` }
      }
      const found = re.exec(sampleText(sample))
      return {
        satisfied: Boolean(found),
        detail: found ? `matched /${when.value}/: ${found[0]}` : evidence(sample),
      }
    }
    case 'number': {
      const value = extractNumber(sample, when.jsonPath)
      if (value === undefined) {
        return {
          satisfied: false,
          detail: `no number found${when.jsonPath ? ` at ${when.jsonPath}` : ''}: ${evidence(sample)}`,
        }
      }
      const satisfied = boundHolds(value, when.bound)
      const target = boundPhrase(when.bound)
      return {
        satisfied,
        detail: satisfied ? `${value} ${target}` : `${value}, waiting for ${target}`,
      }
    }
  }
}

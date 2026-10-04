/**
 * Structured verdict for the /review reviewer sub-agent's final report.
 *
 * The reviewer prompt (plugin.json → agents[reviewer], step 7) instructs the
 * sub-agent to END its report with a fenced ```json block:
 *
 *   {"verdict":"pass|fail|comment","summary":"<one line>",
 *    "findings":[{"severity":"P0|P1|P2|P3","title":"...","file":"path","line":123}]}
 *
 * This module is the canonical parser for that block. Models are unreliable
 * emitters, so extraction is layered — (a) the LAST fenced ```json block,
 * (b) the last balanced trailing `{…}` object containing `"verdict"` — and each
 * candidate gets a trailing-comma repair pass before JSON.parse. When no valid
 * structured verdict exists, `parseReviewReport` falls back to the legacy
 * text parse (`[P0]`–`[P3]` line markers, the same tags the UI badges use) with
 * `verdict: null` — consumers MUST treat a null verdict exactly as they treated
 * an unstructured report before (zero regression; never default to fail).
 *
 * Pure and dependency-free: consumed by tests today and safe for any host-side
 * consumer to vendor (apps/api mirrors the vocabulary in kanban-engine/judge.ts,
 * which cannot import plugin sources).
 */

export type ReviewVerdict = 'pass' | 'fail' | 'comment'
export type FindingSeverity = 'P0' | 'P1' | 'P2' | 'P3'

export interface ReviewFinding {
  severity: FindingSeverity
  title: string
  file?: string
  line?: number
}

export interface StructuredReviewVerdict {
  verdict: ReviewVerdict
  summary: string
  findings: ReviewFinding[]
}

export type ParsedReviewReport =
  | ({ source: 'structured' } & StructuredReviewVerdict)
  | { source: 'legacy'; verdict: null; summary: null; findings: ReviewFinding[] }

const VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'comment'])
const SEVERITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3'])

/** Last fenced ```json block's body, or null. (Bare ``` fences are handled by
 *  the trailing-object fallback — only explicitly-tagged json fences count here.) */
function lastFencedJsonBlock(text: string): string | null {
  const re = /```json\s*\n?([\s\S]*?)```/gi
  let last: string | null = null
  for (let m = re.exec(text); m; m = re.exec(text)) last = m[1]
  return last
}

/**
 * Extract the balanced `{…}` object starting at `start`, string-aware (braces
 * inside string literals don't count). Null when it never closes. Starting from
 * an explicit `{` position (rather than sweeping top-level objects) makes the
 * scan immune to an UNCLOSED stray `{` earlier in the prose, which would
 * otherwise swallow the real verdict object into one unbalanced blob.
 */
function extractBalancedFrom(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Balanced `{…}` candidates containing `"verdict"`, LAST-first (the verdict is
 *  contractually the report's tail). Bounded scan — reports are small. */
function trailingVerdictCandidates(text: string): string[] {
  const out: string[] = []
  let idx = text.lastIndexOf('{')
  for (let scans = 0; idx >= 0 && scans < 64; scans++) {
    const obj = extractBalancedFrom(text, idx)
    if (obj?.includes('"verdict"')) out.push(obj)
    idx = text.lastIndexOf('{', idx - 1)
  }
  return out
}

/** Drop commas whose next non-whitespace char closes a container (`}` / `]`),
 *  string-aware so a `", }"` inside a string literal survives. */
export function repairTrailingCommas(json: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      out += ch
      continue
    }
    if (ch === '"') inString = true
    else if (ch === ',') {
      let j = i + 1
      while (j < json.length && /\s/.test(json[j])) j++
      if (json[j] === '}' || json[j] === ']') continue // drop the trailing comma
    }
    out += ch
  }
  return out
}

/** JSON.parse with a trailing-comma repair retry. Null on failure, never throws. */
function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(repairTrailingCommas(raw))
    } catch {
      return null
    }
  }
}

function normalizeFinding(value: unknown): ReviewFinding | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  const severity = typeof rec.severity === 'string' ? rec.severity.trim().toUpperCase() : ''
  if (!SEVERITIES.has(severity)) return null
  const title = typeof rec.title === 'string' ? rec.title.trim() : ''
  if (!title) return null
  const finding: ReviewFinding = { severity: severity as FindingSeverity, title }
  if (typeof rec.file === 'string' && rec.file.trim()) finding.file = rec.file.trim()
  const line = typeof rec.line === 'number' ? rec.line : Number(rec.line)
  if (Number.isFinite(line) && line > 0) finding.line = Math.floor(line)
  return finding
}

/** Validate a parsed candidate into a structured verdict; null when the verdict
 *  is missing/invalid (an invalid verdict NEVER coerces — callers fall back). */
function validate(parsed: unknown): StructuredReviewVerdict | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const rec = parsed as Record<string, unknown>
  const verdict = typeof rec.verdict === 'string' ? rec.verdict.trim().toLowerCase() : ''
  if (!VERDICTS.has(verdict)) return null
  const summary = typeof rec.summary === 'string' ? rec.summary.trim() : ''
  const findings = Array.isArray(rec.findings)
    ? rec.findings.map(normalizeFinding).filter((f): f is ReviewFinding => f !== null)
    : []
  return { verdict: verdict as ReviewVerdict, summary, findings }
}

/**
 * Extract the structured verdict from a reviewer report, or null.
 * Order: (a) the LAST fenced ```json block; (b) the LAST balanced `{…}` object
 * containing `"verdict"` (covers bare fences and fenceless emissions). Each
 * candidate gets the trailing-comma repair retry. A block that parses but fails
 * validation (e.g. verdict "maybe") does NOT win — later fallbacks still run.
 */
export function parseStructuredVerdict(text: string): StructuredReviewVerdict | null {
  const fenced = lastFencedJsonBlock(text)
  if (fenced) {
    const v = validate(tryParse(fenced.trim()))
    if (v) return v
  }
  for (const candidate of trailingVerdictCandidates(text)) {
    const v = validate(tryParse(candidate))
    if (v) return v
  }
  return null
}

/** Same leading-tag grammar the UI badge parser uses (reviewSuggestions.ts). */
const LEGACY_LINE_RE = /\[(P[0-3])\]/i
const FILE_LINE_RE = /([\w@./~-]+\.[A-Za-z][\w]*):(\d+)/

/**
 * Legacy fallback: scan the report for `[P0]`–`[P3]`-tagged lines (the summary
 * format the reviewer has always emitted) and lift severity + optional file:line.
 */
export function parseLegacyFindings(text: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  for (const rawLine of text.split('\n')) {
    const m = rawLine.match(LEGACY_LINE_RE)
    if (!m) continue
    const severity = m[1].toUpperCase() as FindingSeverity
    const rest = rawLine
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[\s—–:-]+/, '')
      .trim()
    const loc = rest.match(FILE_LINE_RE)
    // The title is the line minus its tag and (when present) its file:line token.
    const title =
      (loc
        ? rest
            .replace(loc[0], '')
            .replace(/^[\s—–:-]+/, '')
            .replace(/[\s—–:-]+$/, '')
            .trim()
        : rest) ||
      rest ||
      rawLine.trim()
    const finding: ReviewFinding = { severity, title }
    if (loc) {
      finding.file = loc[1]
      finding.line = Number(loc[2])
    }
    findings.push(finding)
  }
  return findings
}

/**
 * Parse a reviewer report, structured-first with the legacy text fallback.
 * `source: 'legacy'` carries `verdict: null` — the consumer keeps whatever
 * default outcome it had before structured verdicts existed (for the kanban
 * reviewer that is the lenient default-PASS path, never fail).
 */
export function parseReviewReport(text: string): ParsedReviewReport {
  const structured = parseStructuredVerdict(text)
  if (structured) return { source: 'structured', ...structured }
  return { source: 'legacy', verdict: null, summary: null, findings: parseLegacyFindings(text) }
}

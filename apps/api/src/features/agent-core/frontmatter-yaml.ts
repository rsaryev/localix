/**
 * Markdown frontmatter — the ONE place a `---` block is found, parsed and rewritten.
 *
 * The block used to be found by four copies of the same regex, read twice (a hand-rolled
 * YAML-ish line parser for flat fields AND a real `yaml` parse for nested ones, which could
 * disagree about the same file), and written by editing lines of text. The line writer emitted
 * `description: Use when: x` verbatim — invalid YAML that every real parser, Claude Code's
 * included, rejects. So: one splitter, one `yaml` Document per file that both read views come
 * from, and writes through `Document.set`/`toString`, which quotes what needs quoting and keeps
 * comments, key order and every key this codebase does not model.
 *
 * Tolerance (CC-compatible): reading never throws. Hand-written frontmatter is often not quite
 * YAML — an unquoted `: ` or a leading `@`/`` ` ``/`*` in a value. Such a block is parsed a
 * second time with its top-level plain values quoted (the repair Claude Code applies), and the
 * flat view reads whatever the parser recovered when even that fails.
 *
 * Pure module — the `yaml` package and string work only, no fs / chat / UI imports.
 */
import { Document, isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml'

/** A leading `---\n … \n---` block; group 1 is its YAML text. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

const PARSE_OPTIONS = { uniqueKeys: false } as const
/** No line folding on write: a long description stays one line, as it was authored. */
const WRITE_OPTIONS = { lineWidth: 0 } as const

export interface FrontmatterBlock {
  /** The YAML text between the fences. */
  yaml: string
  /** Everything after the closing fence, untrimmed. */
  body: string
}

/** Normalize a BOM and CRLF line endings — a Windows-authored file must parse the same. */
function normalize(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
}

/** Split `raw` into its frontmatter YAML and body; `null` when it has no frontmatter. */
export function splitFrontmatter(raw: string): FrontmatterBlock | null {
  const text = normalize(raw)
  const match = FRONTMATTER_RE.exec(text)
  return match ? { yaml: match[1] ?? '', body: text.slice(match[0].length) } : null
}

/**
 * A top-level plain value YAML cannot hold unquoted: one starting with a reserved or alias/tag
 * character (`@file`, `` `code` ``, `*.md`), or containing a `: ` (`Use when: …`). Quoted, flow
 * and block-indicator values are already explicit and are never touched. The repair only runs on
 * a block that failed to parse, and only wins when it parses with fewer errors.
 */
const NEEDS_QUOTES = /^(?![\s"'[{|>])(?:[@`%*&!]|.*:(?:\s|$))/

/** Single-quote each top-level value YAML rejects, so the rest of the block can still parse. */
function quotePlainValues(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => {
      const match = /^([\w-]+):[ \t]+(\S.*?)[ \t]*$/.exec(line)
      if (!match || !NEEDS_QUOTES.test(match[2]!)) return line
      return `${match[1]}: '${match[2]!.replace(/'/g, "''")}'`
    })
    .join('\n')
}

/** Parse frontmatter YAML, repairing unquoted special values when the first parse fails. */
function parseFrontmatterYaml(yaml: string): Document.Parsed {
  const doc = parseDocument(yaml, PARSE_OPTIONS)
  if (doc.errors.length === 0) return doc
  const repaired = parseDocument(quotePlainValues(yaml), PARSE_OPTIONS)
  return repaired.errors.length < doc.errors.length ? repaired : doc
}

/**
 * The frontmatter as a plain object with real YAML types — the view for NESTED structures (CC
 * `hooks:` maps, agent `mcpServers:`, rule `paths:` lists). `undefined` when there is no
 * frontmatter, it is not valid YAML even after repair, or it is not a mapping, so a caller
 * treats an unreadable block as absent rather than half-read.
 */
export function parseYamlFrontmatterBlock(raw: string): Record<string, unknown> | undefined {
  const block = splitFrontmatter(raw)
  if (!block) return undefined
  const doc = parseFrontmatterYaml(block.yaml)
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined
  const value: unknown = doc.toJS()
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** A parsed scalar's value as text: primitives as themselves, anything else (a date) as JSON. */
function valueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return JSON.stringify(value) ?? ''
}

/** A scalar as frontmatter TEXT: strings unquoted and folded, other types as written (`1.0`). */
function scalarText(node: Scalar): string {
  if (node.value === null || node.value === undefined) return ''
  return (
    typeof node.value === 'string' ? node.value : (node.source ?? valueText(node.value))
  ).trim()
}

/**
 * The FLAT view plus the trimmed body: every top-level scalar as a string (booleans and numbers
 * exactly as written — callers test `/^true$/i`), every list (block or inline `[a, b]`) as a
 * string array; nested maps have no flat value (read them with `parseYamlFrontmatterBlock`).
 * Reads what the parser recovered even from a block that stays invalid, so one bad nested value
 * does not cost a file its `name` and `description`. `{ fields: {}, body }` with no frontmatter.
 */
export function parseMarkdownFrontmatter(raw: string): {
  fields: Record<string, string | string[]>
  body: string
} {
  const block = splitFrontmatter(raw)
  if (!block) return { fields: {}, body: normalize(raw).trim() }
  const fields: Record<string, string | string[]> = {}
  const doc = parseFrontmatterYaml(block.yaml)
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || pair.key.value === null) continue
      const key = valueText(pair.key.value)
      const value = pair.value
      if (value === null || value === undefined) fields[key] = ''
      else if (isScalar(value)) fields[key] = scalarText(value)
      else if (isSeq(value))
        fields[key] = value.items.flatMap((item) => (isScalar(item) ? [scalarText(item)] : []))
    }
  }
  return { fields, body: block.body.trim() }
}

/**
 * Rewrite `raw` with `values` set in its frontmatter and `body` after it. Every other key, its
 * comments and the key order are kept; a key not yet present is added at the top, in the order
 * given. A value may be a list or a mapping (`localix: {priority: 1}`); `undefined` removes the
 * key. Throws when the existing block is not YAML even after repair — writing would have to
 * drop keys it cannot read, and a save must never silently lose part of a file.
 */
export function renderFrontmatterFile(
  raw: string,
  values: Record<string, unknown>,
  body: string,
): string {
  const block = splitFrontmatter(raw)
  const parsed = parseFrontmatterYaml(block?.yaml ?? '')
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!
    throw new Error(`The existing frontmatter is not valid YAML: ${first.message.split('\n')[0]}`)
  }
  // An empty block (or a new file) starts a fresh mapping; anything else that is not one would
  // be overwritten, so it is refused like unreadable YAML.
  const doc: Document = parsed.contents === null ? new Document({}) : parsed
  const map = doc.contents
  if (!isMap(map)) throw new Error('The existing frontmatter is not a YAML mapping')
  let inserted = 0
  for (const [key, value] of Object.entries(values)) {
    // `undefined` is "no value": the key goes, and a key that was never there stays absent.
    if (value === undefined) doc.delete(key)
    else if (doc.has(key)) doc.set(key, value)
    else map.items.splice(inserted++, 0, doc.createPair(key, value))
  }
  return `---\n${doc.toString(WRITE_OPTIONS)}---\n\n${body}\n`
}

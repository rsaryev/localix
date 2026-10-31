/**
 * Cheap lexical entity extraction for the VBC dependency graph. No LLM.
 *
 * Entities are the "things" a message introduces — file paths, URLs, code
 * symbols/identifiers. If an entity introduced at message i reappears later at
 * message j, message i is depended-upon and therefore valuable. Tool-target paths
 * are the highest-precision signal; lexical symbols are noisier and weighted lower
 * downstream. A stoplist + length floor curb false positives.
 */
import type { ChatMessage } from '../chat'
import {
  isCommandItem,
  isFileChangeItem,
  isToolBackedItem,
  type ToolBackedItem,
} from '../agents/items'
import { itemResultModelText } from './result-text'
import { inputFilePaths, inputQueries, normalizePathKey } from './path-key'

export type EntityKind = 'path' | 'url' | 'symbol'

export interface EntityRef {
  value: string
  kind: EntityKind
  /** True when sourced from a tool target/input (high precision) vs free text. */
  precise: boolean
}

// Paths: either a slash-bearing path with an extension, or a bare `name.ext`.
const PATH_RE = /\b[\w.~@-]*\/[\w./~@-]+\.\w{1,8}\b|\b[\w-]{2,}\.[a-zA-Z][a-zA-Z0-9]{0,7}\b/g
const URL_RE = /\bhttps?:\/\/[^\s)"'<>]+/g
const BACKTICK_RE = /`([^`\n]{2,80})`/g
// camelCase, snake_case, PascalCase-with-digit, or dotted member access.
const SYMBOL_RE =
  /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z]+_[A-Za-z0-9_]+|[A-Z][a-zA-Z]+[0-9A-Z][A-Za-z0-9]*)\b/g

// Common words / fake "extensions" that the path/symbol regexes catch as noise.
const STOPLIST = new Set([
  'e.g',
  'i.e',
  'etc',
  'vs',
  'a.m',
  'p.m',
  'no.',
  'fig',
  'eq',
  'README',
  'TODO',
  'NOTE',
  'FIXME',
  'WARNING',
  'ERROR',
  'INFO',
  'JSON',
  'HTTP',
  'HTTPS',
  'API',
  'URL',
  'URI',
  'HTML',
  'CSS',
  'SQL',
])

const MIN_SYMBOL_LEN = 4

function pushMatches(
  re: RegExp,
  text: string,
  kind: EntityKind,
  precise: boolean,
  out: Map<string, EntityRef>,
) {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] ?? m[0]).trim().replace(/[.,;:)]+$/, '')
    if (!raw) continue
    if (raw.length < (kind === 'symbol' ? MIN_SYMBOL_LEN : 2)) continue
    if (STOPLIST.has(raw)) continue
    const key = entityKey({ value: raw, kind, precise })
    if (!out.has(key)) out.set(key, { value: raw, kind, precise })
  }
}

/** Extract entities from a single free-text blob. */
export function extractTextEntities(text: string): EntityRef[] {
  const out = new Map<string, EntityRef>()
  pushMatches(URL_RE, text, 'url', false, out)
  pushMatches(PATH_RE, text, 'path', false, out)
  pushMatches(BACKTICK_RE, text, 'symbol', false, out)
  pushMatches(SYMBOL_RE, text, 'symbol', false, out)
  return [...out.values()]
}

function addPrecise(out: Map<string, EntityRef>, value: string, kind: EntityKind): void {
  if (value.length < 2) return
  const entity: EntityRef = { value, kind, precise: true }
  const key = entityKey(entity)
  if (!out.has(key)) out.set(key, entity)
}

/** High-precision entities from a tool-backed item's structured fields + input args. */
function toolItemEntities(item: ToolBackedItem, out: Map<string, EntityRef>): void {
  // PRECISE structured paths: file_change items carry exact touched paths.
  if (isFileChangeItem(item)) {
    for (const c of item.changes) if (c.path?.trim()) addPrecise(out, c.path, 'path')
  }
  // A command's invocation is a low-value symbol entity (not a path).
  if (isCommandItem(item) && item.command?.trim()) {
    addPrecise(out, item.command, 'symbol')
  }
  const input = item.input as Record<string, unknown> | undefined
  if (input && typeof input === 'object') {
    // Each file of a batched read and each pattern of a batched search is its own entity.
    for (const path of inputFilePaths(input)) if (path.length >= 2) addPrecise(out, path, 'path')
    for (const query of inputQueries(input)) if (query.length >= 2) addPrecise(out, query, 'symbol')
    if (typeof input.url === 'string' && input.url.length >= 2) addPrecise(out, input.url, 'url')
  }
}
/** Canonical inverted-index key for an entity (paths normalized; see path-key.ts). */
export function entityKey(entity: EntityRef): string {
  return entity.kind === 'path' ? normalizePathKey(entity.value) : entity.value
}

function addEntities(target: Map<string, EntityRef>, entities: Iterable<EntityRef>): void {
  for (const entity of entities) {
    const key = entityKey(entity)
    if (!target.has(key)) target.set(key, entity)
  }
}

// Memoized by message object identity: extraction runs four regexes over the
// message's full text + every tool result — O(message bytes) — once per VBC
// planning pass, i.e. at every run start. History messages are immutable once
// parsed and (since the repository's parse cache) keep their identity ACROSS
// runs, so unchanged messages extract exactly once per process. Callers treat
// the returned array as read-only (dep-graph only iterates it).
const entityCache = new WeakMap<object, EntityRef[]>()

/** Extract the deduped entity set introduced by a message (content + tool I/O). */
export function extractEntities(m: ChatMessage): EntityRef[] {
  const cached = entityCache.get(m)
  if (cached) return cached
  const out = new Map<string, EntityRef>()
  if (typeof m.content === 'string' && m.content) addEntities(out, extractTextEntities(m.content))
  for (const item of m.items ?? []) {
    if (!isToolBackedItem(item)) continue
    toolItemEntities(item, out)
    const result = itemResultModelText(item)
    if (result) addEntities(out, extractTextEntities(result))
  }
  const entities = [...out.values()]
  entityCache.set(m, entities)
  return entities
}

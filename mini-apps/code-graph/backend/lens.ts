import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolveWithin } from '@localixai/path-containment'
import { fileId } from '../shared/ids'
import { LENS_KINDS, MAX_TRAIL, type CodeCard, type CodeLink, type Lens } from '../shared/lens'
import type { CallSite, NodeSummary } from '../shared/model'
import type { CodeGraph } from './graph/code-graph'
import { subtree } from './graph/traverse'
import { breadcrumb } from './graph/view'

/**
 * The call lens for a trail of symbols: each one's source as the file says it NOW, with every
 * name the graph resolved — calls and other uses of a declaration — marked at its token.
 *
 * Source is read at request time rather than stored in the index: the index keeps what a file
 * means, not its text, and a card should show the code as it is. When the file changed since it
 * was indexed the card still shows the current text and says so — the links then point at lines
 * that may have moved, and a refresh (already running) realigns them.
 *
 * Columns arrive from tree-sitter as offsets into the raw line (web-tree-sitter parses a JS string
 * as UTF-16, so they are string indices, not UTF-8 bytes — a test with `é` pins it); the card lays
 * tokens out in cells of a tab-expanded line, so that conversion happens here, once.
 */
const MAX_CARD_LINES = 300
const MAX_CALLERS = 16
const TAB = '  '

export async function buildLens(
  graph: CodeGraph,
  root: string,
  trail: readonly string[],
  cachedHash: (path: string) => string | undefined,
): Promise<Lens | null> {
  const ids = trail
    .slice(0, MAX_TRAIL)
    .filter((id) => LENS_KINDS.has(graph.nodes.get(id)?.kind ?? ''))
  const first = ids[0]
  if (!first) return null
  const cards: CodeCard[] = []
  for (const id of ids) {
    const card = await codeCard(graph, root, id, cachedHash)
    if (card) cards.push(card)
  }
  const callers = new Map<string, NodeSummary>()
  for (const edge of graph.in(first)) {
    if (edge.kind !== 'calls' || callers.size >= MAX_CALLERS) continue
    const caller = graph.summary(edge.source)
    if (caller) callers.set(caller.id, caller)
  }
  return { trail: cards, callers: [...callers.values()] }
}

async function codeCard(
  graph: CodeGraph,
  root: string,
  id: string,
  cachedHash: (path: string) => string | undefined,
): Promise<CodeCard | null> {
  const node = graph.summary(id)
  if (!node?.line || !node.endLine) return null
  // The path comes from the index, but it is still joined under the root and checked: nothing a
  // request names can make the card read outside the project.
  const absolute = resolveWithin(root, node.path)
  if (!absolute) return null
  const bytes = await readFile(absolute).catch(() => null)
  if (!bytes) return null
  const raw = bytes.toString('utf8').split('\n')
  const first = node.line
  const last = Math.min(node.endLine, first + MAX_CARD_LINES - 1, raw.length)
  const rawSlice = raw.slice(first - 1, last)

  const links: CodeLink[] = []
  const callees = new Map<string, NodeSummary>()
  const taken = new Set<string>()
  const add = (kind: CodeLink['kind'], site: CallSite) => {
    const text = raw[site.line - 1]
    const target = site.target === id ? null : graph.summary(site.target)
    const key = `${site.line}:${site.column}`
    if (text === undefined || !target || site.line < first || site.line > last || taken.has(key))
      return
    taken.add(key)
    links.push({
      kind,
      line: site.line,
      column: cellOf(text, site.column),
      endColumn: cellOf(text, site.endColumn),
      target,
    })
    if (kind === 'call' && !callees.has(target.id)) callees.set(target.id, target)
  }
  // Calls first, so a callee token is a call link: a class card collects its members' calls too,
  // since a class's code is its members' code.
  for (const member of subtree(graph, id))
    for (const site of graph.callSites(member)) add('call', site)
  for (const site of graph.refSites(fileId(node.path))) add('ref', site)
  links.sort((a, b) => a.line - b.line || a.column - b.column)

  const trail = breadcrumb(graph, id)
  const fromFile = trail.findIndex((crumb) => crumb.kind === 'file')
  return {
    node,
    outline: fromFile >= 0 ? trail.slice(fromFile) : trail,
    ...(node.language ? { language: node.language } : {}),
    startLine: node.line,
    lines: rawSlice.map((line) => line.replace(/\r$/, '').replaceAll('\t', TAB)),
    truncated: last < node.endLine,
    stale: cachedHash(node.path) !== createHash('sha256').update(bytes).digest('hex'),
    links,
    callees: [...callees.values()],
  }
}

/** A string offset in a raw line → its cell in the tab-expanded line. */
export function cellOf(line: string, offset: number): number {
  let cells = 0
  for (const char of line.slice(0, offset)) cells += char === '\t' ? TAB.length : char.length
  return cells
}

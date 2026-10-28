import type { AgentItem, AgentItemStatus, ToolBackedItem } from '@localixai/agent/agents'
import {
  isToolBackedItem,
  isItemStreaming,
  hasItemError as itemFailed,
} from '@localixai/agent/agents/items'
import {
  isAlwaysStandaloneToolName,
  itemActionVerb as coreItemActionVerb,
} from '@localixai/api/item-format'
import { isUiNavigationOutput } from '@localixai/mini-app-sdk/ui'
import { toolDisplayLabel, toolMeta, toolSummaryNoun } from './cards/meta'
import { baseName, truncate, strField } from './cards/format'
import { countPatchChanges } from './cards/liveCode'
import { batchUnitCount, readInputPaths, searchInputQueries } from './cards/batchInput'

/**
 * Presentation helpers over the normalized `AgentItem` model. The UI renders
 * items directly (no ToolPart), so these centralize the small derivations the
 * cards and the chain header need. Per-tool presentation
 * data (icons, verbs, labels, stacking) lives in `cards/meta.ts` — this module
 * only derives strings from items.
 *
 * The item type-guards / status predicates come from core — we only re-export
 * them here so existing call sites keep importing from one place.
 */

export { isToolBackedItem as isToolBacked, isItemStreaming }

/**
 * A call the PERSON declined, or a card nobody answered. It ends `failed` on the wire — the
 * model must learn it did not run — but painting it red told the person they had caused an
 * error by pressing Deny. It renders neutral, with their own sentence (`personMessage`) as its
 * headline. `refusal: 'human'` is the server's tag for both (`permission-gate.ts`).
 */
export function isItemDeclined(item: AgentItem): boolean {
  if (!isToolBackedItem(item) || !itemFailed(item)) return false
  return item.error?.refusal === 'human'
}

/** A failure worth the error treatment: everything that failed except a person's own decline. */
export function hasItemError(item: AgentItem): boolean {
  return itemFailed(item) && !isItemDeclined(item)
}

/** Finds the active tail without rescanning settled tool history on every delta. */
export function findLastStreamingToolItem(items: readonly AgentItem[]): ToolBackedItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item && isToolBackedItem(item) && isItemStreaming(item)) return item
  }
  return undefined
}

/**
 * The RAW text a failed tool produced — what goes in the card's ERR block.
 *
 * A tool's stderr is raw by definition and an operator needs it verbatim, so this deliberately
 * prefers it over the classification. It used to be the other way round, which meant a classified
 * `userMessage` ERASED the tool's actual output from the only place it was ever shown.
 */
export function itemErrorMessage(item: ToolBackedItem): string | undefined {
  if (!hasItemError(item)) return undefined
  // A refused call never ran, so it has no raw output: its `message` is the instruction the
  // model was given ("Do NOT retry it…"), which is not the person's to read.
  if (item.error?.kind === 'blocked' || item.error?.personMessage)
    return item.error.personMessage ?? item.error.userMessage
  const raw = item.errorText ?? item.error?.message
  return raw && raw !== item.error?.userMessage ? raw : item.error?.userMessage
}

/**
 * The ONE classified sentence for a failed item, for a collapsed header row.
 *
 * The cards said "Failed" — true, and the whole story until you expanded the card. The runtime
 * already classifies (`ToolErrorPayload.userMessage`); nothing was reading it. First line only:
 * a header row is one line, and a stderr dump used as a fallback must not become a paragraph.
 */
export function itemErrorHeadline(item: ToolBackedItem): string | undefined {
  // Every failed item, a declined one included: the decline's headline is the person's own
  // sentence ("You declined bash"), it just is not painted as an error.
  if (!itemFailed(item)) return undefined
  const classified = (item.error?.personMessage ?? item.error?.userMessage)?.trim()
  if (classified) return classified.split('\n')[0]
  const raw = (item.errorText ?? item.error?.message)?.trim().split('\n')[0]
  // A long raw line is not a headline — the card body still has it in full.
  return raw && raw.length <= 100 ? raw : undefined
}

/**
 * True for tool items that must render OUTSIDE any ToolChain cluster (running
 * stream, HITL ask/quiz, a mini app's content surface) — folding them into a chain
 * digest would hide (and unmount) an interactive surface.
 */
export function isStandaloneItem(item: AgentItem): boolean {
  return (
    isToolBackedItem(item) &&
    (item.standalone === true ||
      item.presentation?.transcript === 'content' ||
      isAlwaysStandaloneToolName(item.name) ||
      (item.type === 'tool_call' && isUiNavigationOutput(item.output)))
  )
}

/**
 * Short active-verb for the spinner / chain header (e.g. "Running"). The branching
 * lives in the shared SDK (`itemActionVerb`); the UI only injects its per-tool verb
 * map (`toolMeta`), so the indicator cannot drift from the verb the agent reports.
 */
export function itemActionVerb(item: AgentItem): string {
  return coreItemActionVerb(item, (name) => toolMeta(name).verb)
}

/**
 * Short per-item label for stacked summaries ("a.ts, b.ts, +3"): the most
 * identifying argument of the call, falling back to the meta label.
 */
export function itemStackLabel(item: ToolBackedItem): string {
  switch (item.type) {
    case 'command': {
      const desc = strField(item.input, 'description')
      return truncate(desc ?? item.command.split('\n')[0] ?? 'command', 60)
    }
    case 'file_change':
      return item.changes[0]?.path ? baseName(item.changes[0].path) : 'file'
    case 'mcp_call':
      return item.tool
    case 'tool_call': {
      const input = item.input
      // A batched read or search names its first file/pattern and how many more ride along.
      const more = (n: number) => (n > 1 ? ` +${n - 1}` : '')
      const paths = item.name === 'Read' ? readInputPaths(input) : []
      if (paths.length) return `${baseName(paths[0]!)}${more(paths.length)}`
      const path = strField(input, 'path')
      if (path) return baseName(path)
      const queries = item.name === 'Search' ? searchInputQueries(input) : []
      if (queries.length) return `${truncate(queries[0]!, 40)}${more(queries.length)}`
      const query = strField(input, 'query')
      if (query) return truncate(query, 40)
      const named = strField(input, 'name') ?? strField(input, 'key') ?? strField(input, 'field')
      const action = strField(input, 'action')
      if (action) return named ? `${action}: ${named}` : action
      const task = strField(input, 'title') ?? strField(input, 'task')
      if (task) return truncate(task, 50)
      // The tool's own name when nothing is registered for it — see `toolDisplayLabel`.
      return toolDisplayLabel(item.name)
    }
  }
}

/** "files" → "file", "searches" → "search", "quizzes" → "quiz" — for n === 1. */
function singularNoun(noun: string): string {
  if (noun.endsWith('zzes')) return noun.slice(0, -3)
  if (/(?:ches|shes|sses|xes)$/.test(noun)) return noun.slice(0, -2)
  if (noun.endsWith('s')) return noun.slice(0, -1)
  return noun
}

/** At most this many tool kinds named in a chain summary; the rest fold into "+N more". */
const MAX_SUMMARY_KINDS = 3

/**
 * One-line aggregate of a tool chain, in narrative order of first use:
 * live  → "Reading 1 file, running 15 commands…"
 * done  → "Read 3 files, ran 15 commands"
 * Edits/writes are counted in FILES touched (unique paths), never in calls —
 * "edited 3 files", not "edited 3 edits". Returns null when nothing is tool-backed.
 */
export function chainSummary(items: AgentItem[], live: boolean): string | null {
  interface Group {
    verb: string
    label: string
    noun: string
    count: number
    paths: Set<string> | null
  }
  const groups = new Map<string, Group>()
  for (const item of items) {
    if (!isToolBackedItem(item)) continue
    const meta = toolMeta(item.name)
    const noun = toolSummaryNoun(item.name)
    const key = `${meta.verb}|${noun}`
    let group = groups.get(key)
    if (!group) {
      group = {
        verb: meta.verb,
        label: meta.label,
        noun,
        count: 0,
        paths: item.type === 'file_change' ? new Set() : null,
      }
      groups.set(key, group)
    }
    // A batched read is several files and a batched search several searches, not one call.
    group.count += batchUnitCount(item.name, item.input)
    if (item.type === 'file_change' && group.paths) {
      for (const change of item.changes) if (change.path) group.paths.add(change.path)
    }
  }
  if (groups.size === 0) return null

  const segments = [...groups.values()].map((group) => {
    // file_change kinds always count in files (paths may lag while streaming).
    const byFiles = group.paths !== null
    const count = byFiles ? group.paths!.size || group.count : group.count
    const noun = byFiles ? 'files' : group.noun
    const word = (live ? group.verb : group.label).toLowerCase()
    return `${word} ${count} ${count === 1 ? singularNoun(noun) : noun}`
  })
  const shown = segments.slice(0, MAX_SUMMARY_KINDS)
  const overflow = segments.length - shown.length
  const text = shown.join(', ') + (overflow > 0 ? `, +${overflow} more` : '')
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
  return live ? `${capitalized}…` : capitalized
}

/** Total +/- line counts across every file change in a chain (parsed from the diffs). */
export function chainDiffStats(items: AgentItem[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const item of items) {
    if (!isToolBackedItem(item) || item.type !== 'file_change') continue
    for (const change of item.changes) {
      if (!change.diff) continue
      const counts = countPatchChanges(change.diff)
      additions += counts.additions
      deletions += counts.deletions
    }
  }
  return { additions, deletions }
}

export function statusLabel(status: AgentItemStatus): string {
  switch (status) {
    case 'completed':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'aborted':
      return 'Stopped'
    case 'pending':
    case 'running':
      return ''
  }
  return ''
}

/**
 * Shared presentation helpers over the normalized `AgentItem` model — a leaf
 * subpath (`@localixai/api/item-format`) so every client derives the same strings
 * without duplicating the logic, and without the `@localixai/agent` core absorbing
 * client-only presentation concerns.
 *
 * Pure + dependency-free at runtime (the only import is the erased `AgentItem`
 * type), exactly like the sibling shared leaves (`slash-catalog`, `mode-catalog`,
 * `loops-format`). Add new cross-client item derivations here, not in core.
 */

import type { AgentItem } from '@localixai/agent/agents'

/**
 * Interpret descriptor-owned visibility, never a tool name. Failures override suppression.
 * Finalization and clients share this rule so a hidden item cannot withdraw other activity
 * in its message. The descriptor travels on the item through streaming and persistence.
 */
export function isTranscriptItemHidden(item: AgentItem): boolean {
  return (
    'presentation' in item &&
    item.presentation?.transcript === 'hidden' &&
    item.status !== 'failed' &&
    item.status !== 'aborted' &&
    !item.error &&
    !item.errorText
  )
}

/**
 * Tool surfaces that must stay mounted as independent rows instead of joining a
 * collapsible ToolChain. This is shared with session-detail projection: if the
 * server treated one of these as a collapsed row, it could remove the very
 * input/output needed to decide and render the live surface on first paint.
 */
export const STANDALONE_TOOL_NAMES = ['ask', 'quiz', 'terminal'] as const

const standaloneToolNames: ReadonlySet<string> = new Set(STANDALONE_TOOL_NAMES)

export function isAlwaysStandaloneToolName(name: string): boolean {
  return standaloneToolNames.has(name)
}

/**
 * Short present-tense verb for the live activity line (spinner / chain header),
 * e.g. "Running", "Reading", "Calling github/search". Every client calls this, so an
 * activity indicator cannot drift from the verb the agent actually reports.
 *
 * `resolveToolVerb` lets a client enrich the verb from its own per-tool
 * presentation map (the web passes `toolMeta(name).verb`); omitted, the verb
 * falls back to the item's own `activeVerb` / name. Narrative items return
 * "Working" — the caller decides whether to show it.
 */
export function itemActionVerb(
  item: AgentItem,
  resolveToolVerb?: (name: string) => string | undefined,
): string {
  switch (item.type) {
    case 'command':
      return 'Running'
    case 'file_change':
      return resolveToolVerb?.(item.name) ?? 'Editing'
    case 'mcp_call':
      return `Calling ${item.tool}`
    case 'tool_call': {
      const verb = resolveToolVerb?.(item.name)
      return verb && verb !== 'Running' ? verb : item.activeVerb || 'Running'
    }
    case 'text':
    case 'reasoning':
      return 'Working'
  }
}

/* ── Change stats for a file-mutating item ───────────────────────────────────
 * The "+N −M" a card/transcript line shows for a `write`/`edit`
 * item, derived from the tool's ARGUMENTS — including the PARTIAL, mid-stream
 * ones, which is why every input here is `unknown`: while the model is still
 * emitting the call, `edits` may be a half-built array of half-built objects.
 * Missing/ill-typed fields count as 0 rather than throwing, so a card can render
 * a live count from the first keystroke of the arguments.
 *
 * This lived TWICE — once in the web card (`{additions, deletions}`) and once in a
 * second client (`{added, removed}`) — and the two had already drifted into different
 * vocabularies for the same numbers. One owner, one vocabulary: `added`/`removed`; the
 * web card adapts it to its own names at a single boundary
 * (`tool-parts/cards/liveCode.ts`), never at a call site.
 */

export interface ChangeStats {
  added: number
  removed: number
}

const NO_CHANGES: ChangeStats = { added: 0, removed: 0 }

/** Lines in a (possibly partial, possibly absent) text payload. Non-string / empty → 0. */
export function countTextLines(value: unknown): number {
  return typeof value === 'string' && value.length > 0 ? value.split('\n').length : 0
}

/**
 * +/− line counts for a (possibly partial) V4A/unified patch text. Counts the
 * `+`/`-` body lines and skips the `+++`/`---` file headers, which are not changes.
 */
export function countPatchChanges(patch: unknown): ChangeStats {
  if (typeof patch !== 'string') return { ...NO_CHANGES }
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

/**
 * Approximate +/− line counts for an edits array: each edit removes `old_string`'s
 * lines and adds `new_string`'s. Anything that is not an array of objects with those
 * string fields contributes 0 — the mid-stream partial is the common case, not an error.
 */
export function countEditChanges(edits: unknown): ChangeStats {
  if (!Array.isArray(edits)) return { ...NO_CHANGES }
  let added = 0
  let removed = 0
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue
    const { new_string: newString, old_string: oldString } = edit as Record<string, unknown>
    added += countTextLines(newString)
    removed += countTextLines(oldString)
  }
  return { added, removed }
}

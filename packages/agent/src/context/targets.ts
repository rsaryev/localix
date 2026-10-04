/**
 * Resolve a stable "target identity" for a tool-backed item, used by the VBC
 * dependency graph to detect SUPERSESSION: a later observation/mutation of the
 * same target makes an earlier observation of it redundant (near-losslessly
 * compressible).
 *
 * Classes:
 * - `read`  — observes a target (READ_RESULT_TOOLS: read/lsp/search/…); a newer read or any
 *   mutate of the same key supersedes it.
 * - `mutate` — changes a target (file_change items: edit/write/apply_patch);
 *   supersedes earlier reads of the same key (the file changed). Eligible whether
 *   the change completed OR failed (the gate is "terminal", matching the old
 *   output-available/output-error condition).
 * - `nonidempotent` — side-effecting (command items: bash); never supersedes.
 *
 * The item model gives PRECISE file targets: a `file_change` item carries the exact
 * `changes[].path` list, so we no longer regex patch bodies for paths.
 */
import {
  isCommandItem,
  isFileChangeItem,
  isMcpCallItem,
  isToolCallItem,
  type ToolBackedItem,
} from '../agents/items'
import { READ_RESULT_TOOLS as READ_TOOLS } from './tool-classes'
import { normalizePathKey } from './path-key'

export type TargetClass = 'read' | 'mutate' | 'nonidempotent' | 'none'

export interface ToolTarget {
  class: TargetClass
  /** Normalized identity keys (lowercased paths, or a query string). */
  keys: string[]
}

export type ResolveTarget = (item: ToolBackedItem) => ToolTarget | undefined

// Shared single source of truth — see path-key.ts (kept as a local alias so the
// call sites below read naturally).
const normPath = normalizePathKey

function inputField(item: ToolBackedItem, ...fields: string[]): string | undefined {
  const input = item.input as Record<string, unknown> | undefined
  if (!input || typeof input !== 'object') return undefined
  for (const f of fields) {
    const v = input[f]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** Default tool→target mapping, keyed on the registered VBC tool classes. */
export function defaultResolveTarget(item: ToolBackedItem): ToolTarget | undefined {
  // Terminal gate: only completed/failed items have a settled observation (mirrors
  // the old output-available/output-error condition).
  if (item.status !== 'completed' && item.status !== 'failed') return undefined

  if (isFileChangeItem(item)) {
    // PRECISE: the exact paths the change touched. Fall back to input.path only
    // when the structured changes are empty (e.g. an in-flight/degenerate item).
    const keys = item.changes
      .map((c) => c.path)
      .filter((p): p is string => !!p && !!p.trim())
      .map(normPath)
    if (keys.length) return { class: 'mutate', keys }
    const path = inputField(item, 'path', 'file', 'file_path')
    return path ? { class: 'mutate', keys: [normPath(path)] } : undefined
  }
  if (isCommandItem(item)) {
    return { class: 'nonidempotent', keys: [] }
  }
  if (isToolCallItem(item)) {
    if (READ_TOOLS.has(item.name)) {
      const path = inputField(item, 'path', 'file', 'file_path')
      if (path) return { class: 'read', keys: [normPath(path)] }
      const query = inputField(item, 'query')
      if (query) return { class: 'read', keys: [`q:${query.trim().toLowerCase()}`] }
      return undefined
    }
    return { class: 'none', keys: [] }
  }
  if (isMcpCallItem(item)) {
    return { class: 'none', keys: [] }
  }
  return { class: 'none', keys: [] }
}

/** Resolve an item's target, preferring an app-supplied override resolver. */
export function resolveTarget(
  item: ToolBackedItem,
  override?: ResolveTarget,
): ToolTarget | undefined {
  return override?.(item) ?? defaultResolveTarget(item)
}

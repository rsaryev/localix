import type { ComponentType } from 'react'
import type { ToolName } from '@localixai/api/tool-names'
import { isAlwaysStandaloneToolName } from '@localixai/api/item-format'
import {
  contributedToolMeta,
  FALLBACK_META,
  MCP_META,
  STANDALONE_FALLBACK_META,
} from './fallbackMeta'
import { CORE_META } from './coreMeta'
import { NON_CORE_META, type NonCoreToolName } from './nonCoreMeta'

export { FALLBACK_META, MCP_META } from './fallbackMeta'
export { nonCoreToolMeta, type NonCoreToolName } from './nonCoreMeta'

/**
 * Presentation metadata for tool-backed items, keyed by TOOL NAME (the name the
 * model called — `item.name`, present on every tool-backed item regardless of
 * its specialized type). Pure data — card components live in `registry.tsx` so
 * this module stays import-light for helpers (verbs and stacking).
 *
 * Adding a tool: one entry here (+ a card in `registry.tsx` if it needs rich UI).
 */
export interface ToolMeta {
  /** One past-tense word a finished summary opens with: "Started" in "Started 2 agents". */
  label: string
  /** The plural that follows the count: "agents", "files", "Store actions". */
  noun: string
  /** One present participle for live state: "Starting" in "Starting 2 agents…", the spinner. */
  verb: string
  icon: ComponentType<{ className?: string }>
  /**
   * When true, a run of consecutive identical calls collapses into one summary
   * row. Reserved for high-frequency, low-signal data/file ops. Interactive or
   * visually rich tools and interactive surfaces never stack.
   */
  stackable: boolean
  /**
   * When true, the tool is a pure exploration op (file read, search/grep,
   * code lookup). Runs of 2+ CONSECUTIVE COMPLETED read-only calls — even of
   * different tools — fold into one summary row ("Explored 5 locations");
   * see `cards/stacking.ts`. Never set on tools that mutate anything.
   */
  readOnly?: boolean
}

/**
 * Every tool name the transcript can present: the server's own `ToolName`, plus the
 * sanctioned non-core exemptions.
 *
 * This is the vocabulary the card registries key on. It exists so that a tool RENAMED
 * server-side, or simply typo'd, fails `bun run type-check` at the registry instead of
 * silently reverting a rich card to the generic wrench — the exact failure `CORE_META`
 * already documents having shipped ("five real tools ship as unlabeled wrenches").
 */
export type PresentableToolName = ToolName | NonCoreToolName

const META: Record<string, ToolMeta> = { ...CORE_META, ...NON_CORE_META }

/**
 * The name to SHOW for a call, where a summary or a preview has nothing better to name it by: the
 * tool's own name, which is one spelling everywhere (`Agent`, `ContextBudget`, a mini app's own), and
 * the family word for MCP tools. Never `label`: that is a past tense ("Started"), and a preview of
 * "Started, Started +3" names nothing.
 */
export function toolDisplayLabel(name: string): string {
  return name.startsWith('mcp_') ? 'MCP' : name
}

/**
 * The plural a chain summary counts a tool in. A registered tool has its own noun; any other is
 * counted in calls of its own name ("Ran 3 TodoWrite calls"), which is all that tells two of them
 * apart in one sentence.
 */
export function toolSummaryNoun(name: string): string {
  const meta = toolMeta(name)
  return meta === FALLBACK_META || meta === MCP_META || meta === STANDALONE_FALLBACK_META
    ? `${toolDisplayLabel(name)} ${meta.noun}`
    : meta.noun
}

/** Look up presentation meta for a tool name (fallback for unknown tools). */
export function toolMeta(name: string): ToolMeta {
  const registered = META[name] ?? contributedToolMeta(name)
  if (registered) return registered
  if (name.startsWith('mcp_')) return MCP_META
  return isAlwaysStandaloneToolName(name) ? STANDALONE_FALLBACK_META : FALLBACK_META
}

/** Whether the transcript's own table owns `name` — a contributed card never replaces one. */
export function isCoreToolMetaName(name: string): boolean {
  return Object.hasOwn(META, name)
}

/** Every name with a registered entry — the enumeration `meta.test.ts` guards over. */
export function allToolMetaNames(): string[] {
  return Object.keys(META)
}

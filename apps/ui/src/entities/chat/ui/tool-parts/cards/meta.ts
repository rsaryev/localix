import { currentToolName } from './legacyToolNames'
import type { ComponentType } from 'react'
import { TOOL, type ToolName } from '@localixai/api/tool-names'
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
  /** Imperative label, e.g. "Read", "Searched" — used in stacked summaries. */
  label: string
  /** Plural noun for aggregated counts, e.g. "files", "searches". */
  noun: string
  /** Present-participle verb for live state, e.g. "Reading". */
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
 * The label to SHOW for a tool name.
 *
 * A registered tool has a curated label; an unregistered one has only its own name — and that beats
 * the generic fallback word, which is what a folded run of them was reduced to. Measured before this:
 * 200 consecutive `Bash` calls rendered as "Tool 200 calls · Tool, Tool +198", with the name gone
 * from both the summary and the preview.
 *
 * Asked separately from {@link toolMeta} on purpose: that function must keep returning the
 * `FALLBACK_META` IDENTITY, because `meta.test.ts` proves a card has a real entry by comparing
 * against it. A derived object would make that guard pass for everything.
 */
export function toolDisplayLabel(name: string): string {
  const registered = META[name] ?? contributedToolMeta(name)
  if (registered) return registered.label
  return name.startsWith('mcp_') ? MCP_META.label : name
}

/** Look up presentation meta for a tool name (fallback for unknown tools). */
export function toolMeta(name: string): ToolMeta {
  const registered = META[currentToolName(name)] ?? contributedToolMeta(name)
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

/** Every tool the SERVER owns. Re-exported so the guard derives from the owner, not from our copy. */
export function coreToolNames(): ToolName[] {
  return Object.values(TOOL)
}

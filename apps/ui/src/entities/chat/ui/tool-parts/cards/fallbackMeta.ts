import { Plug, Wrench } from 'lucide-react'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'
import { toolCardFor } from '@/shared/contrib/toolCards'
import type { ToolMeta } from './meta'

/*
 * Meta for names the core table does not own: the generic fallback, MCP tools, standalone
 * surfaces without an entry, and the rows plugins contribute for their own tools.
 */

/**
 * Unknown and plugin tools — and, since external-agent transcripts landed, every FOREIGN tool.
 *
 * `stackable` is true for the same reason MCP's is: a run of consecutive calls to ONE name is one
 * activity however little we know about the name, and `groupConsecutiveItems` only stacks a same-name
 * run at three or more. It was false, and a foreign transcript is where that stopped being harmless —
 * folding keys on this table, so a repeated foreign tool folded nowhere.
 *
 * Mounting a foreign-agent run of 1,169 consecutive `Bash` calls:
 *
 *   foreign name, unstackable   1,169 groups · 12,875 DOM nodes · 96 ms
 *   registered read-only name       1 group  ·      34 nodes    ·  2 ms
 *
 * `readOnly` stays absent, which is the conservative half: read-only runs fold at TWO and claiming
 * that for a tool we cannot classify would fold a run of writes on the strength of a guess.
 */
export const FALLBACK_META: ToolMeta = {
  label: 'Tool',
  noun: 'calls',
  verb: 'Running',
  icon: Wrench,
  stackable: true,
}
export const MCP_META: ToolMeta = {
  label: 'MCP',
  noun: 'calls',
  verb: 'Calling',
  icon: Plug,
  stackable: true,
}

/**
 * A standalone surface with no entry of its own.
 *
 * `STANDALONE_TOOL_NAMES` are the surfaces that must stay independent rows, and the rule used to
 * hold only because the generic fallback happened to be unstackable — an accident, and one that
 * broke the moment the fallback needed to stack for foreign runs. It is enforced at the lookup now,
 * so a standalone name added without a meta entry is safe by construction rather than by luck.
 */
export const STANDALONE_FALLBACK_META: ToolMeta = { ...FALLBACK_META, stackable: false }

/**
 * The row a plugin registered for a tool it owns (`host.toolCards`), in this table's shape.
 *
 * Consulted only AFTER the core table, so a plugin cannot restyle a built-in by registering its
 * name. Cached per contribution because callers compare meta by identity (the stacking fold, the
 * `FALLBACK_META` guard) and a fresh object per call would read as a different tool every render.
 */
const contributedMeta = new WeakMap<ToolCardContribution, ToolMeta>()

export function contributedToolMeta(name: string): ToolMeta | undefined {
  const contribution = toolCardFor(name)
  if (!contribution) return undefined
  const cached = contributedMeta.get(contribution)
  if (cached) return cached
  const { Icon, ...presentation } = contribution.presentation
  const meta: ToolMeta = { ...presentation, icon: Icon }
  contributedMeta.set(contribution, meta)
  return meta
}

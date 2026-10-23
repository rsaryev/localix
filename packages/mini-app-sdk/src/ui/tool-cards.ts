import type { ComponentType } from 'react'
import type { ToolCallItem } from '@localixai/agent/agents'

import type { IconComponent, MiniAppOwnedContribution } from './contrib'

/**
 * How a plugin's own tool reads in the transcript.
 *
 * Without this seam a plugin tool rendered as the generic wrench card — its name, raw IN/OUT — and
 * folded under the word "Tool" when called repeatedly, while every built-in tool got a verb, a
 * noun and a card. The difference was not the tool's worth but who owned the table: the host's
 * presentation map is keyed by CORE tool names, so a tool that moved out of core lost its
 * presentation the day it moved. The table is open now; a plugin registers the row for the tool
 * it owns.
 */
export interface ToolPresentation {
  /** Imperative label for stacked summaries, e.g. "Board". */
  label: string
  /** Plural noun for aggregated counts, e.g. "tasks". */
  noun: string
  /** Present-participle verb for live state, e.g. "Updating board". */
  verb: string
  Icon: IconComponent
  /** A run of consecutive calls collapses into one summary row. */
  stackable: boolean
  /** A pure exploration op; never set on a tool that mutates anything. */
  readOnly?: boolean
}

export interface ToolCardContribution extends MiniAppOwnedContribution {
  /** The tool's name as the model calls it — one this plugin registered on its backend. */
  tool: string
  presentation: ToolPresentation
  /**
   * The card for one call. Absent: the host's generic card, under this presentation. Built from
   * `@localixai/kit/tool-card` so a plugin's card reads like every built-in one.
   */
  Component?: ComponentType<{ item: ToolCallItem }>
}

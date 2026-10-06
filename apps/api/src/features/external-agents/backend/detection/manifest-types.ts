/**
 * Screen-detection manifests: state classification expressed as DATA.
 *
 * A manifest is a list of rules, each with a stable id, a state, a priority, a region and the
 * patterns that must match. The ids are kept stable for auditing.
 *
 * WHY DATA. Detection lives in per-agent manifests so rules can change without changing the
 * evaluator. Bundled manifests live beside the plugin and can be shadowed from the plugin state
 * directory. The evaluator below never names an agent; adding a kind is adding a manifest.
 */

import type { AgentState } from '../../shared/state'

/**
 * Regions of the rendered screen a rule may look at.
 *
 * DELIBERATE OMISSION, and it matters: the source manifests also match `osc_title` and
 * `osc_progress` — terminal title and progress escape sequences. Roughly a third of their Claude
 * Code and Codex rules are OSC rules, including their highest-priority ones. We have NO OSC
 * channel: our input is the rendered `ScreenSnapshot.text` handed to us by the host's bash tool,
 * which is post-emulation plain text. Rules whose region we cannot evaluate are DROPPED AT LOAD and
 * counted, never silently treated as non-matching — see `loadManifest`. This makes detection here
 * strictly weaker, and the plugin reports that limit rather than implying parity.
 */
export type RegionKind =
  | { readonly kind: 'whole_recent' }
  | { readonly kind: 'bottom_non_empty_lines'; readonly count: number }
  | { readonly kind: 'after_last_horizontal_rule' }
  /** Codex's composer line (`›`) is the anchor. */
  | { readonly kind: 'after_last_prompt_marker' }

export interface Matcher {
  /** ALL of these substrings must be present in the region. */
  readonly contains?: readonly string[]
  /** At least one nested matcher must match. */
  readonly any?: readonly Matcher[]
  /** Every nested matcher must match. */
  readonly all?: readonly Matcher[]
  /** No nested matcher may match. */
  readonly not?: readonly Matcher[]
  /** Any of these matches the region as a whole. Rust regex syntax; translated on load. */
  readonly regex?: readonly string[]
  /** Any of these matches at least one single line of the region. */
  readonly lineRegex?: readonly string[]
}

export interface ScreenRule extends Matcher {
  readonly id: string
  readonly state: AgentState
  /** Higher wins. Evaluation is descending priority, first match stops. */
  readonly priority: number
  readonly region: RegionKind
  /**
   * The rule identifies a screen (e.g. Claude Code's transcript viewer) that tells you nothing
   * about the agent's lifecycle. It matches, evaluation STOPS, and the previous state is kept.
   * Explain output records why the update was skipped.
   */
  readonly skipStateUpdate?: boolean
}

export interface DetectionManifest {
  readonly id: string
  readonly version: string
  readonly displayName: string
  readonly rules: readonly ScreenRule[]
  /** Rule ids dropped at load because they need a region we cannot evaluate. Reported, not hidden. */
  readonly unsupportedRules?: readonly string[]
  /** Set when a user override from the state dir shadowed the bundled manifest. */
  readonly overridden?: boolean
}

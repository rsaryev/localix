/**
 * The screen-manifest evaluator, and the single-authority rule it enforces.
 *
 * The central invariant, stated because getting it wrong is the whole failure mode: a lifecycle
 * integration is authoritative when it is installed and actively reporting for the running pane.
 * It does not also run the screen manifest fallback for that same lifecycle authority. This avoids
 * two competing sources of truth.
 *
 * So `resolveState` picks ONE authority and consults only that one. The authority a delegated CLI
 * used to claim by REPORTING its own state (a webhook protocol injected into its prompt) is gone:
 * it required the foreign agent to cooperate, and silence from an agent that ignored the
 * instruction was indistinguishable from work. What is left is what we can observe — the screen
 * through a manifest, and the agent's own transcript.
 */

import type { AgentState, StateExplain } from '../../shared/state'
import { IDLE_FALLBACK_REASON } from '../../shared/state'
import type { DetectionManifest, ScreenRule } from './manifest-types'
import { extractRegion } from './regions'
import { matches } from './match'

export interface ScreenEvaluation {
  readonly state: AgentState
  readonly matchedRule?: string
  readonly skipStateUpdate: boolean
  readonly fallbackReason?: string
}

/** Evaluate a rendered screen against one manifest. Rules run in descending priority, first match stops. */
export function evaluateScreen(manifest: DetectionManifest, screen: string): ScreenEvaluation {
  const ordered = [...manifest.rules].sort(
    (a: ScreenRule, b: ScreenRule) => b.priority - a.priority,
  )
  for (const rule of ordered) {
    const region = extractRegion(screen, rule.region)
    if (!matches(rule, region)) continue
    if (rule.skipStateUpdate) {
      return { state: 'unknown', matchedRule: rule.id, skipStateUpdate: true }
    }
    return { state: rule.state, matchedRule: rule.id, skipStateUpdate: false }
  }
  /**
   * If no manifest rule matches for a known agent, the state falls back to `idle` and labels that
   * fallback as `default_known_agent_idle_fallback` in explain output.
   * Falling back to `blocked` would be the dangerous choice: it would make a waiting caller believe
   * a decision is needed when none is. Falling back to `idle` and SAYING it is the honest one.
   */
  return { state: 'idle', skipStateUpdate: false, fallbackReason: IDLE_FALLBACK_REASON }
}

export interface ResolveInput {
  /** The manifest for this agent kind, or undefined when the kind has none. */
  readonly manifest?: DetectionManifest
  /** Latest rendered screen for the delegation, if we have observed one. */
  readonly screen?: string
  /** State carried forward when a matched rule declines to update it. */
  readonly previous?: AgentState
  readonly observedAt: number
}

export function resolveState(input: ResolveInput): StateExplain {
  const { manifest, screen, observedAt } = input

  if (!manifest) {
    return {
      state: 'unknown',
      authority: 'none',
      summary:
        'No detection manifest exists for this agent kind, so its live state cannot be classified. Add a manifest to give it one.',
      observedAt,
    }
  }

  if (screen === undefined) {
    return {
      state: 'unknown',
      authority: 'screen-manifest',
      manifestId: manifest.id,
      manifestVersion: versionNumber(manifest.version),
      manifestOverridden: manifest.overridden,
      summary: 'No screen has been observed for this delegation yet.',
      observedAt,
    }
  }

  const evaluation = evaluateScreen(manifest, screen)
  const state =
    evaluation.skipStateUpdate && input.previous !== undefined ? input.previous : evaluation.state

  return {
    state,
    authority: 'screen-manifest',
    matchedRule: evaluation.matchedRule,
    manifestId: manifest.id,
    manifestVersion: versionNumber(manifest.version),
    manifestOverridden: manifest.overridden,
    fallbackReason: evaluation.fallbackReason,
    summary: buildSummary(manifest, evaluation, state),
    observedAt,
  }
}

function buildSummary(
  manifest: DetectionManifest,
  evaluation: ScreenEvaluation,
  state: AgentState,
): string {
  if (evaluation.skipStateUpdate) {
    return `Rule "${evaluation.matchedRule}" in manifest ${manifest.id}@${manifest.version} identified a screen that carries no lifecycle information, so the previous state (${state}) was kept.`
  }
  if (evaluation.fallbackReason) {
    const dropped = manifest.unsupportedRules?.length ?? 0
    const caveat =
      dropped > 0
        ? ` ${dropped} rule(s) in this manifest need terminal-title or progress signals this host does not expose, and were not evaluated.`
        : ''
    return `No rule in manifest ${manifest.id}@${manifest.version} matched the screen, so the state degraded to idle (${evaluation.fallbackReason}) rather than being guessed.${caveat}`
  }
  return `Rule "${evaluation.matchedRule}" in manifest ${manifest.id}@${manifest.version} matched the screen and classified it ${state}.`
}

/** Manifest versions are date-stamped strings; expose a comparable integer for the UI. */
function versionNumber(version: string): number | undefined {
  const digits = version.replace(/\D/g, '')
  return digits ? Number(digits) : undefined
}

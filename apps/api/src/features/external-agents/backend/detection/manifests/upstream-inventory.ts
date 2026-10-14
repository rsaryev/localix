/**
 * The expected rule inventory of each agent's manifest, recorded as data.
 *
 * A manifest can lose a rule without anything saying so: `btw_overlay_working` was in neither
 * `rules` nor `unsupportedRules` for as long as this plugin existed, and it happened to be the only
 * `working` rule Claude Code has that does not need an OSC title. Nothing failed — the state simply
 * never appeared.
 *
 * So the inventory lives here and `upstream-inventory.test.ts` holds our manifests against it:
 * every expected rule must be either present or declared unsupported, and a present one must keep
 * its state and priority. The inventory is recorded data, so the test does not depend on a path
 * outside this repo, which would pass or fail on where it is run.
 *
 * Refreshing this is a deliberate act: re-record, see what the guard reports, and include or
 * declare each new rule. That is the review the silent drop skipped.
 */

import type { AgentState } from '../../../shared/state'

export interface UpstreamRule {
  readonly id: string
  readonly state: AgentState
  /** Higher wins — a drift here reorders evaluation without changing any rule. */
  readonly priority: number
}

export interface UpstreamManifest {
  /** Our manifest's id, which is what the guard resolves against. */
  readonly manifestId: string
  /** The manifest file this inventory describes. */
  readonly source: string
  /** The manifest's own `version` field. */
  readonly version: string
  readonly rules: readonly UpstreamRule[]
  /**
   * Rules we authored ourselves, not in the recorded inventory. Declared so the guard can tell a local
   * addition from a stale id, rather than accepting anything it does not recognise.
   */
  readonly localRules?: readonly string[]
}

export const UPSTREAM_MANIFESTS: readonly UpstreamManifest[] = [
  {
    manifestId: 'claude-code',
    source: 'src/detect/manifests/claude.toml',
    version: '2026.07.13.1',
    rules: [
      { id: 'osc_title_working', state: 'working', priority: 1100 },
      { id: 'transcript_viewer', state: 'unknown', priority: 1000 },
      { id: 'live_blocked_form', state: 'blocked', priority: 980 },
      { id: 'dynamic_workflow_prompt', state: 'blocked', priority: 980 },
      { id: 'btw_overlay_working', state: 'working', priority: 975 },
      { id: 'live_prompt_box', state: 'idle', priority: 950 },
      { id: 'model_picker_menu', state: 'unknown', priority: 900 },
      { id: 'bash_permission_prompt', state: 'blocked', priority: 850 },
      { id: 'generic_permission_prompt', state: 'blocked', priority: 840 },
      { id: 'legacy_no_prompt_blocker', state: 'blocked', priority: 300 },
      { id: 'osc_title_idle', state: 'idle', priority: 250 },
      { id: 'osc_progress_idle', state: 'idle', priority: 250 },
    ],
  },
  {
    manifestId: 'codex',
    source: 'src/detect/manifests/codex.toml',
    version: '2026.07.18.1',
    rules: [
      { id: 'osc_title_blocked', state: 'blocked', priority: 1100 },
      { id: 'osc_title_working', state: 'working', priority: 1050 },
      { id: 'transcript_viewer', state: 'unknown', priority: 1000 },
      { id: 'live_strong_blocker', state: 'blocked', priority: 900 },
      { id: 'weak_blocker', state: 'blocked', priority: 600 },
      { id: 'screen_working_fallback', state: 'working', priority: 500 },
      { id: 'osc_title_idle', state: 'idle', priority: 100 },
    ],
  },
  {
    manifestId: 'opencode',
    source: 'src/detect/manifests/opencode.toml',
    version: '2026.06.10.1',
    rules: [
      { id: 'permission_required', state: 'blocked', priority: 300 },
      { id: 'interrupt_hint_working', state: 'working', priority: 110 },
      { id: 'progress_bar_working', state: 'working', priority: 100 },
    ],
  },
  {
    manifestId: 'github-copilot',
    source: 'src/detect/manifests/github-copilot.toml',
    version: '2026.07.07.1',
    rules: [
      { id: 'selection_blocker', state: 'blocked', priority: 300 },
      { id: 'working_cancel_hint', state: 'working', priority: 100 },
    ],
  },
  {
    manifestId: 'hermes',
    source: 'src/detect/manifests/hermes.toml',
    version: '2026.06.10.1',
    rules: [
      { id: 'dangerous_command_approval', state: 'blocked', priority: 300 },
      { id: 'interrupt_status_working', state: 'working', priority: 100 },
    ],
  },
  {
    manifestId: 'gemini-cli',
    source: 'src/detect/manifests/gemini.toml',
    version: '2026.06.10.1',
    rules: [
      { id: 'apply_or_allow_change', state: 'blocked', priority: 300 },
      { id: 'esc_cancel_working', state: 'working', priority: 100 },
    ],
  },
]

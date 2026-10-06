/**
 * Claude Code screen manifest.
 *
 * Every rule has a stable id and priority, so one can be diffed against a later revision.
 *
 * `btw_overlay_working` is included and was previously in neither list — see its own note.
 *
 * NOT INCLUDED, and why: `osc_title_working`, `osc_title_idle` and `osc_progress_idle` all read
 * terminal OSC sequences. Our input is the host's rendered screen text, which has no OSC channel,
 * so those three are listed in `unsupportedRules` rather than silently omitted. They would be the
 * highest-priority working/idle signals, which is the main reason detection here is weaker and
 * `idle` leans on the documented fallback.
 *
 * `live_prompt_box` is also dropped: its region is `prompt_box_body`, a Claude-Code-specific
 * extraction we do not implement. Its effect — idle when the prompt box is up and no menu is
 * showing — is what the idle fallback already produces.
 */

import type { DetectionManifest } from '../manifest-types'

export const claudeCodeManifest: DetectionManifest = {
  id: 'claude-code',
  version: '2026.07.13.1',
  displayName: 'Claude Code',
  unsupportedRules: ['osc_title_working', 'osc_title_idle', 'osc_progress_idle', 'live_prompt_box'],
  rules: [
    {
      // The transcript viewer tells you nothing about lifecycle, so it must stop
      // evaluation WITHOUT changing state, or scrolling the transcript would read as idle.
      id: 'transcript_viewer',
      state: 'unknown',
      priority: 1000,
      region: { kind: 'bottom_non_empty_lines', count: 3 },
      skipStateUpdate: true,
      contains: ['showing detailed transcript'],
      any: [
        { contains: ['ctrl+o', 'to toggle'] },
        { contains: ['ctrl+e', 'show all'] },
        { contains: ['ctrl+e', 'collapse'] },
        { contains: ['↑↓ scroll'] },
        { contains: ['? for shortcuts'] },
      ],
    },
    {
      id: 'live_blocked_form',
      state: 'blocked',
      priority: 980,
      region: { kind: 'after_last_horizontal_rule' },
      contains: ['enter to select', 'esc to cancel'],
      any: [
        { contains: ['tab/arrow keys to navigate'] },
        { contains: ['arrow keys to navigate'] },
        { contains: ['arrows to navigate'] },
        { contains: ['↑/↓ to navigate'] },
        { contains: ['↑↓ to navigate'] },
      ],
    },
    {
      id: 'dynamic_workflow_prompt',
      state: 'blocked',
      priority: 980,
      region: { kind: 'whole_recent' },
      contains: ['run a dynamic workflow?', 'esc to cancel'],
    },
    {
      /**
       * A rule that once went missing silently: it appeared in neither `rules`
       * nor `unsupportedRules`, so nothing said it was missing.
       *
       * It matters more than its narrow scope suggests. It is the only `working` rule for Claude
       * Code that does not need an OSC title, and Claude Code 2.1.220 emits no title at all (checked
       * against the installed 257 MB bundle: no `ESC ] 0 ;` / `ESC ] 2 ;`, and no `esc to interrupt`
       * footer text either) — so `osc_title_working` can never fire here and this is the one positive
       * signal left. Both strings are live in that build: "Use /btw to ask a quick side question
       * without interrupting" and "esc to close · esc again quits".
       *
       * The two patterns are an AND, which is why this could not be ported until `lineRegex` stopped
       * being a disjunction: on the old semantics "esc to close" alone would have marked a
       * background-session overlay as an agent at work.
       */
      id: 'btw_overlay_working',
      state: 'working',
      priority: 975,
      region: { kind: 'bottom_non_empty_lines', count: 5 },
      lineRegex: [String.raw`^\s*/btw(?:\s|$)`, String.raw`(?i)esc to close\s*$`],
    },
    {
      // The model picker is a menu but not a blocker; it must not read as blocked.
      id: 'model_picker_menu',
      state: 'unknown',
      priority: 900,
      region: { kind: 'whole_recent' },
      skipStateUpdate: true,
      contains: ['select model', 'enter to set as default', 'esc to cancel'],
      not: [{ contains: ['do you want to proceed?'] }, { contains: ['enter to select'] }],
    },
    {
      id: 'bash_permission_prompt',
      state: 'blocked',
      priority: 850,
      region: { kind: 'whole_recent' },
      contains: ['do you want to proceed?'],
      any: [
        { contains: ['bash command'] },
        { contains: ['bash('] },
        { contains: ['contains expansion'] },
        { contains: ['tab to amend'] },
        { contains: ['ctrl+e to explain'] },
      ],
      all: [
        {
          any: [
            { lineRegex: [String.raw`(?i)^\s*❯?\s*yes\b`] },
            { lineRegex: [String.raw`(?i)^\s*1\.\s*yes\b`] },
            { lineRegex: [String.raw`(?i)^\s*2\.\s*no\b`] },
          ],
        },
      ],
    },
    {
      // The numbered approval menu the driving-claude-code skill documents
      // (`❯ 1. Yes  2. Yes, and don't ask again  3. No`).
      id: 'generic_permission_prompt',
      state: 'blocked',
      priority: 840,
      region: { kind: 'after_last_horizontal_rule' },
      contains: ['do you want to proceed?', 'esc to cancel'],
      all: [
        {
          any: [
            { lineRegex: [String.raw`(?i)^\s*❯?\s*1\.\s*yes\b`] },
            { lineRegex: [String.raw`(?i)^\s*2\.\s*yes\b`] },
            { lineRegex: [String.raw`(?i)^\s*2\.\s*no\b`] },
            { lineRegex: [String.raw`(?i)^\s*3\.\s*no\b`] },
          ],
        },
      ],
    },
    {
      id: 'legacy_no_prompt_blocker',
      state: 'blocked',
      priority: 300,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['do you want to'], any: [{ contains: ['yes'] }, { contains: ['❯'] }] },
        { contains: ['would you like to'], any: [{ contains: ['yes'] }, { contains: ['❯'] }] },
        { contains: ['waiting for permission'] },
        { contains: ['do you want to allow this connection?'] },
        { contains: ['tab to amend'] },
        { contains: ['ctrl+e to explain'] },
        { contains: ['do you want to proceed?', 'esc to cancel'] },
        { contains: ['review your answers'] },
        { contains: ['skip interview and plan immediately'] },
      ],
      not: [{ regex: [String.raw`(?m)^\s*❯\s*$`] }],
    },
  ],
}

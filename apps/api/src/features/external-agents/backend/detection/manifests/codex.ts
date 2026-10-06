/**
 * Codex screen manifest.
 *
 * Every rule has a stable id and priority, so one can be diffed against a later revision.
 *
 * NOT INCLUDED: `osc_title_blocked`, `osc_title_working` and `osc_title_idle`
 * read the terminal title, which our rendered-text input does not carry. Listed in
 * `unsupportedRules`. Losing `osc_title_blocked` in particular means Codex's "Action Required"
 * title signal is unavailable to us, so blocked detection here rests entirely on the two visible
 * screen rules below.
 *
 * `transcript_viewer` and `live_strong_blocker` ideally apply after the last prompt marker. We do
 * not implement that region, so they are scoped to `after_last_horizontal_rule` — the nearest
 * region we do support with the same intent (only consider the current interaction, not
 * scrollback). This is a deliberate approximation, recorded here.
 */

import type { DetectionManifest } from '../manifest-types'

export const codexManifest: DetectionManifest = {
  id: 'codex',
  version: '2026.07.18.1',
  displayName: 'Codex',
  unsupportedRules: ['osc_title_blocked', 'osc_title_working', 'osc_title_idle'],
  rules: [
    {
      id: 'transcript_viewer',
      state: 'unknown',
      priority: 1000,
      region: { kind: 'after_last_prompt_marker' },
      skipStateUpdate: true,
      contains: ['↑/↓ to scroll', 'pgup/pgdn to', 'home/end to jump', 'q to quit'],
      any: [{ contains: ['esc to edit prev'] }, { contains: ['esc/← to edit prev'] }],
    },
    {
      // The approval menu the harness skill warns about
      // ("Codex asks before running shell commands / edits").
      id: 'live_strong_blocker',
      state: 'blocked',
      priority: 900,
      region: { kind: 'after_last_prompt_marker' },
      any: [
        { contains: ['press enter to confirm or esc to cancel'] },
        { contains: ['enter to submit answer'] },
        { contains: ['enter to submit all'] },
        { contains: ['allow command?'] },
      ],
    },
    {
      id: 'weak_blocker',
      state: 'blocked',
      priority: 600,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['[y/n]'] },
        { contains: ['yes (y)'] },
        { contains: ['do you want to'], any: [{ contains: ['yes'] }, { contains: ['❯'] }] },
        { contains: ['would you like to'], any: [{ contains: ['yes'] }, { contains: ['❯'] }] },
      ],
    },
    {
      // The one working signal we can still see without OSC.
      id: 'screen_working_fallback',
      state: 'working',
      priority: 500,
      region: { kind: 'bottom_non_empty_lines', count: 3 },
      lineRegex: [String.raw`^[•◦]\s+Working \([^)]*esc to interrupt\)(?: · .*)?$`],
      not: [{ contains: ['■ Conversation interrupted'] }],
    },
  ],
}

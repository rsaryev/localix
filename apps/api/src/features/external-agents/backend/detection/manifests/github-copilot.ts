/**
 * GitHub Copilot CLI screen rules (id `copilot`, aliases `github-copilot` / `ghcs`), with stable
 * rule ids and priorities.
 *
 * Both rules turn on the same cancel hint, and the ORDER is the whole design: a bare "esc to cancel"
 * means the agent is working and can be stopped, while the same hint beside a "enter to select"
 * means it is waiting for a choice. So the blocker is checked first at 300 and the working rule sits
 * at 100 — inverting them would report every prompt as work in progress.
 *
 * Nothing is dropped: `unsupportedRules` is empty because this manifest needs no OSC channel, unlike
 * Claude Code's and Codex's.
 */

import type { DetectionManifest } from '../manifest-types'

export const githubCopilotManifest: DetectionManifest = {
  id: 'github-copilot',
  version: '2026.07.07.1',
  displayName: 'GitHub Copilot',
  rules: [
    {
      // A cancel hint AND a selection hint: a choice is being awaited.
      id: 'selection_blocker',
      state: 'blocked',
      priority: 300,
      region: { kind: 'whole_recent' },
      all: [
        { any: [{ contains: ['esc to cancel'] }, { contains: ['esc cancel'] }] },
        {
          any: [
            { contains: ['enter to select'] },
            { contains: ['enter to confirm'] },
            { contains: ['enter to submit'] },
            { contains: ['enter accept'] },
          ],
        },
      ],
    },
    {
      // The cancel hint alone: something is running that can be stopped.
      id: 'working_cancel_hint',
      state: 'working',
      priority: 100,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['esc to cancel'] },
        { contains: ['esc cancel'] },
        { contains: ['esc again to cancel'] },
        { contains: ['esc interrupt'] },
      ],
    },
  ],
}

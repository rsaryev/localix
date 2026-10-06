/**
 * opencode screen manifest.
 *
 * Every rule has a stable id and priority, so one can be diffed against a later revision.
 *
 * NOTHING IS DROPPED HERE, unlike the Claude Code and Codex manifests: every rule is scoped
 * `whole_recent` and matches rendered text, which is exactly the input we have. So detection for
 * opencode is as strong as it can be — worth stating, because for the other two it is deliberately
 * weaker and that asymmetry is otherwise invisible.
 *
 * We carry no `visible_blocker` / `visible_working` flags describing what a rule PROVES about a
 * visible screen, because our evaluator only ever sees a visible screen; such a distinction would
 * only matter to reconcile screen rules with OSC signals we do not receive.
 */

import type { DetectionManifest } from '../manifest-types'

export const opencodeManifest: DetectionManifest = {
  id: 'opencode',
  version: '2026.06.10.1',
  displayName: 'opencode',
  rules: [
    {
      id: 'permission_required',
      state: 'blocked',
      priority: 300,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['△ Permission required'] },
        // The footer of opencode's own confirmation prompt: a dismiss hint, a confirm hint, and a
        // selection affordance together. Any one of them alone appears on ordinary screens.
        {
          all: [
            { contains: ['esc dismiss'] },
            {
              any: [
                { contains: ['enter confirm'] },
                { contains: ['enter submit'] },
                { contains: ['enter toggle'] },
              ],
            },
            { any: [{ contains: ['↑↓ select'] }, { contains: ['⇆ tab'] }] },
          ],
        },
      ],
    },
    {
      id: 'interrupt_hint_working',
      state: 'working',
      priority: 110,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['esc to interrupt'] },
        { contains: ['ctrl+c to interrupt'] },
        { contains: ['press esc to interrupt'] },
        { lineRegex: ['(?i).*opencode.*esc (again to )?interrupt'] },
      ],
    },
    {
      id: 'progress_bar_working',
      state: 'working',
      priority: 100,
      region: { kind: 'whole_recent' },
      regex: ['(■|⬝){4,}'],
    },
  ],
}

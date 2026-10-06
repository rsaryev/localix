/**
 * Gemini CLI screen manifest.
 *
 * Every rule has a stable id and priority, so one can be diffed against a later revision.
 *
 * Like the opencode manifest and unlike the other two, nothing is dropped: both rules are scoped
 * `whole_recent` over rendered text.
 *
 * The manifest is SMALL — two rules — and that is deliberate, not an abridgement. It
 * means an unrecognized Gemini screen degrades to `idle` with the fallback reason rather than being
 * guessed, which is the honest outcome the evaluator is built around.
 */

import type { DetectionManifest } from '../manifest-types'

export const geminiCliManifest: DetectionManifest = {
  id: 'gemini-cli',
  version: '2026.06.10.1',
  displayName: 'Gemini CLI',
  rules: [
    {
      id: 'apply_or_allow_change',
      state: 'blocked',
      priority: 300,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['│ Apply this change'] },
        { contains: ['│ Allow execution'] },
        // A bare "yes" is on half the screens an agent ever draws, so it only counts alongside an
        // explicit request for confirmation.
        {
          all: [
            { contains: ['yes'] },
            {
              any: [
                { contains: ['waiting for user confirmation'] },
                { contains: ['│ Do you want to proceed'] },
                { contains: ['do you want to proceed?'] },
              ],
            },
          ],
        },
        { lineRegex: ['(?i)^\\s*❯.*(yes|allow)'] },
      ],
    },
    {
      id: 'esc_cancel_working',
      state: 'working',
      priority: 100,
      region: { kind: 'whole_recent' },
      contains: ['esc to cancel'],
    },
  ],
}

/**
 * Hermes screen rules (id `hermes`, alias `hermes-agent`), with stable rule ids and priorities.
 *
 * `dangerous_command_approval` is the interesting one: it requires an approval VOCABULARY (any of
 * "dangerous command", or the allow/deny triple) AND a navigation hint, so the ordinary appearance
 * of the words "deny" or "allow" in output cannot claim the agent is blocked.
 *
 * Nothing dropped — `unsupportedRules` is empty, as this manifest needs no OSC channel.
 */

import type { DetectionManifest } from '../manifest-types'

export const hermesManifest: DetectionManifest = {
  id: 'hermes',
  version: '2026.06.10.1',
  displayName: 'Hermes',
  rules: [
    {
      id: 'dangerous_command_approval',
      state: 'blocked',
      priority: 300,
      region: { kind: 'whole_recent' },
      any: [
        { contains: ['dangerous command'] },
        { contains: ['allow once', 'allow for this session', 'deny'] },
      ],
      all: [
        {
          any: [
            { contains: ['enter to confirm'] },
            { contains: ['↑/↓ to select'] },
            { contains: ['show full command'] },
          ],
        },
      ],
    },
    {
      id: 'interrupt_status_working',
      state: 'working',
      priority: 100,
      region: { kind: 'whole_recent' },
      any: [{ contains: ['msg=interrupt'] }, { contains: ['ctrl+c cancel'] }],
    },
  ],
}

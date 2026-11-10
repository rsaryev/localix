import { describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'

import { renderPluginPrompt } from './plugin-commands'

// skills.md, "Permission checks on injected commands": a command a deny rule matches aborts the
// invocation. A typed plugin command meets the same check (a typed skill's: the kit's).
const dir = tempDirPerTest('skill-perm-')

describe('a typed plugin command’s injected commands meet the permission rules', () => {
  test('a denied command aborts the command', async () => {
    await expect(
      renderPluginPrompt('Go: !`touch x`', {}, '', {
        cwd: dir(),
        authorize: (command) => (command.startsWith('touch') ? 'denied (no touching)' : undefined),
      }),
    ).rejects.toThrow('Shell command permission check failed')
  })
})

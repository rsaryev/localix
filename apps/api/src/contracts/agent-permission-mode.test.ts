import { describe, expect, test } from 'bun:test'

import { agentPermissionModeOf, childPermissionMode } from './agent-permission-mode'

// sub-agents.md, `permissionMode`: the parent's mode wins unless it is `default` (or `dontAsk`);
// a parent in bypass, accept-edits, auto or plan cannot be narrowed or left by the child.
describe('the permission mode of a delegated child', () => {
  test.each([
    ['default', 'default'],
    ['manual', 'default'],
    ['plan', 'plan'],
    // No Localix mode behaves as these do, so the agent's line changes nothing.
    ['acceptEdits', undefined],
    ['auto', undefined],
    ['dontAsk', undefined],
    ['bypassPermissions', undefined],
    ['nonsense', undefined],
  ] as const)('an agent file saying %s asks for %s', (written, asked) => {
    expect(agentPermissionModeOf(written)).toBe(asked)
  })

  test.each([
    ['default', 'plan', 'plan'],
    ['default', 'default', 'default'],
    ['default', undefined, 'default'],
    ['plan', 'default', 'plan'],
    ['bypass', 'plan', 'bypass'],
    ['autonomous', 'plan', 'autonomous'],
    ['bypass', 'default', 'bypass'],
  ] as const)('a %s conversation with an agent asking %s runs it in %s', (parent, asked, mode) => {
    expect(childPermissionMode(parent, asked)).toBe(mode)
  })
})

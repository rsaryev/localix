import { expect, test } from 'bun:test'

import { buildCcHookRegistry } from './config'

/** A hooks block of Claude Code's settings files enters the registry under its scope. */
test("settings hooks join the registry beside plugins', under their scope", async () => {
  const { registry } = await buildCcHookRegistry({
    projectDir: '/repo',
    settingsHooks: [
      {
        source: 'project',
        raw: {
          hooks: {
            PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt' }] }],
          },
        },
      },
    ],
  })
  const handler = registry.PostToolUse?.[0]?.handlers[0]
  expect(handler).toMatchObject({ command: 'fmt', source: 'project' })
  expect(registry.PostToolUse?.[0]?.matcher).toBe('Edit')
})

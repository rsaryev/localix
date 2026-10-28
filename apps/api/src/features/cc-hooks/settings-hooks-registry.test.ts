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

// hooks.md: the same handler in more than one settings file runs once; a plugin's copy stays.
test('an identical handler in several settings files is registered once', async () => {
  const block = (source: 'user' | 'project' | 'local', command = 'fmt') => ({
    source,
    raw: {
      hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }] },
    },
  })
  const { registry } = await buildCcHookRegistry({
    projectDir: '/repo',
    settingsHooks: [block('user'), block('project'), block('local', 'lint')],
    pluginHooks: [
      {
        pluginName: 'p',
        pluginRoot: '/p',
        dataDir: '/d',
        raw: { hooks: block('user').raw.hooks },
      },
    ],
  })
  const commands = (registry.PostToolUse ?? []).flatMap((g) => g.handlers.map((h) => h.command))
  expect(commands).toEqual(['fmt', 'lint', 'fmt'])
})

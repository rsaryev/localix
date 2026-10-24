/**
 * hooks.md, "Hook handler fields": `statusMessage` is the custom spinner message shown while the
 * hook runs.
 */
import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { buildCcHookRegistry } from './config'
import { createCcHooksRuntime } from './run'

test('statusMessage is shown while its hook runs, and cleared after', async () => {
  const { registry } = await buildCcHookRegistry({
    projectDir: tmpdir(),
    pluginHooks: [],
    settingsHooks: [
      {
        source: 'user',
        raw: {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: 'command', command: 'cat >/dev/null', statusMessage: 'Loading context…' },
                ],
              },
            ],
          },
        },
      },
    ],
  })
  const seen: [string, boolean][] = []
  await createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: { warn: () => {}, info: () => {} },
    onHookStatus: (message, active) => seen.push([message, active]),
  }).runSessionStart('startup')
  expect(seen).toEqual([
    ['Loading context…', true],
    ['Loading context…', false],
  ])
})

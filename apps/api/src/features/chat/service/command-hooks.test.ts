/** `/hooks`: the hooks a chat's folder would run, by event, from where each came. */
import { describe, expect, test } from 'bun:test'

import { buildCcHookRegistry } from '../../cc-hooks/config'
import { formatHooks } from './command-hooks'

async function build() {
  return buildCcHookRegistry({
    projectDir: '/work/app',
    settingsHooks: [
      {
        source: 'user',
        raw: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] }],
          Stop: [{ hooks: [{ type: 'http', url: 'https://example.test/stop' }] }],
        },
      },
      {
        source: 'project',
        raw: {
          PreToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'prompt', prompt: 'Is this safe?' }] },
          ],
        },
      },
    ],
    pluginHooks: [
      {
        pluginName: 'review',
        pluginRoot: '/p/review',
        dataDir: '/d/review',
        sensitiveKeys: [],
        raw: {
          SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hi.sh' }] }],
        },
      },
    ],
  })
}

describe('/hooks', () => {
  test('lists each event with its matchers, handlers and where they came from', async () => {
    const { registry, skipped } = await build()
    const text = formatHooks(registry, skipped.length)
    expect(text).toContain('**PreToolUse**')
    expect(text).toContain('`Bash`: command `./guard.sh` (user settings)')
    expect(text).toContain('`Edit|Write`: prompt “Is this safe?” (project settings)')
    expect(text).toContain('**Stop**')
    expect(text).toContain('all: http https://example.test/stop (user settings)')
    expect(text).toContain('plugin `review`')
    expect(text.indexOf('**SessionStart**')).toBeLessThan(text.indexOf('**PreToolUse**'))
    expect(text).toContain('4 hooks')
  })

  test('says where to put hooks when there are none', () => {
    expect(formatHooks({}, 0)).toContain('No hooks')
    expect(formatHooks({}, 0)).toContain('settings.json')
  })

  test('counts the handlers it could not read', () => {
    expect(formatHooks({}, 2)).toContain('2 handlers could not be read')
  })
})

import { describe, expect, it } from 'bun:test'
import type { RegisteredHandler } from '@rsaryev/llx-plugin/hooks'
import { formatHookEntries } from './listing'

const entry = (over: Partial<RegisteredHandler>): RegisteredHandler =>
  ({
    id: 'h1',
    event: 'Stop',
    handler: { type: 'command', command: 'echo done' },
    source: { kind: 'settings', label: '[settings]', scope: 'user' },
    ...over,
  }) as RegisteredHandler

describe('/hooks', () => {
  it('says how to add one when the folder has none', () => {
    expect(formatHookEntries([])).toContain('No hooks')
  })

  it('lists each hook under its event, in event order, with where it came from', () => {
    const text = formatHookEntries([
      entry({ id: 'a' }),
      entry({
        id: 'b',
        event: 'PreToolUse',
        matcher: 'Bash',
        handler: { type: 'prompt', prompt: 'Is this safe?' } as RegisteredHandler['handler'],
        source: { kind: 'plugin', label: '[plugin:review]', pluginName: 'review' },
      }),
      entry({ id: 'c', source: { kind: 'skill', label: '[skill]' } }),
    ])
    expect(text).toStartWith('**Hooks** — 3 hooks')
    expect(text.indexOf('**PreToolUse**')).toBeLessThan(text.indexOf('**Stop**'))
    expect(text).toContain('- `Bash`: prompt “Is this safe?” (plugin `review`)')
    expect(text).toContain('- all: command `echo done` (user settings)')
    expect(text).toContain('(a skill)')
  })
})

import { describe, expect, test } from 'bun:test'

import { createCcHookSessions } from './cc-hook-sessions'

const guard = {
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo guard' }] }],
}

// hooks.md: skill hooks run for "the rest of the session once the skill is invoked".
describe('a session’s skill hooks', () => {
  test('are kept once per skill, in invocation order, until the session is forgotten', () => {
    const sessions = createCcHookSessions()
    const other = { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] }
    sessions.addSkillHooks('s1', { raw: guard, source: 'skill', lifetime: 'session' })
    sessions.addSkillHooks('s1', { raw: other, source: 'skill', lifetime: 'session' })
    // The same skill invoked again registers nothing new.
    sessions.addSkillHooks('s1', { raw: guard, source: 'skill', lifetime: 'session' })
    expect(sessions.skillHooks('s1').map((hooks) => hooks.raw)).toEqual([guard, other])
    expect(sessions.skillHooks('s2')).toEqual([])
    sessions.forget('s1')
    expect(sessions.skillHooks('s1')).toEqual([])
  })

  test('the same hooks from two plugins are two registrations', () => {
    const sessions = createCcHookSessions()
    const plugin = (name: string) => ({ name, root: `/p/${name}`, dataDir: `/d/${name}` })
    sessions.addSkillHooks('s1', { raw: guard, source: 'skill', plugin: plugin('a') })
    sessions.addSkillHooks('s1', { raw: guard, source: 'skill', plugin: plugin('b') })
    expect(sessions.skillHooks('s1').map((hooks) => hooks.plugin?.name)).toEqual(['a', 'b'])
  })
})

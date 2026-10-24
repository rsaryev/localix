import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { renderSkillBody } from './skill-render'
import { renderPluginPrompt } from './plugin-commands'

// skills.md, "Inject dynamic context": "Command output is inserted as plain text and is not
// re-scanned". Arguments fill the skill's own text; what a command printed, or a file the skill
// pulled in, keeps its `$1` and `$ARGUMENTS` — a shell script shown to the model stays that script.
describe('injected text keeps its own placeholders', () => {
  const dir = tempDirPerTest('skill-render-')
  const ctx = () => ({ sessionId: 's1', workingDir: dir(), effort: 'low', dynamic: true })

  it('a skill fills its arguments but not into command output or an inlined file', async () => {
    writeTree(dir(), {
      'out.txt': 'echo "$1" $ARGUMENTS',
      'script.sh': 'deploy "$0"',
    })
    const content = 'Target $0.\nOutput: !`cat out.txt`\nScript: @script.sh'
    const body = await renderSkillBody({ content, path: join(dir(), 'SKILL.md') }, 'prod', ctx())
    expect(body).toContain('Target prod.')
    expect(body).toContain('Output: echo "$1" $ARGUMENTS')
    expect(body).toContain('deploy "$0"')
    expect(body).not.toContain('ARGUMENTS: prod')
  })

  it('a plugin command does the same', async () => {
    writeTree(dir(), { 'out.txt': 'echo "$1" ${HOME_DIR}' })
    const out = await renderPluginPrompt('Run $0: !`cat out.txt`', {}, 'web extra', { cwd: dir() })
    expect(out).toBe('Run web: echo "$1" ${HOME_DIR}')
  })

  // skills.md: "A doubled backslash such as `\\$1` leaves both backslashes in place, and `$1`
  // still expands to the argument value."
  it('a doubled backslash keeps both backslashes and still fills the argument', async () => {
    const body = await renderSkillBody({ content: 'a \\\\$0 b \\$0' }, 'x', {
      ...ctx(),
      dynamic: false,
    })
    expect(body).toBe('a \\\\x b $0')
    expect(await renderPluginPrompt('a \\\\$0 b \\$0', {}, 'x')).toBe('a \\\\x b $0')
  })
})

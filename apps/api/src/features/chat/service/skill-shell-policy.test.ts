import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { renderPluginPrompt } from './plugin-commands'
import { expandSkillContent, SKILL_SHELL_DISABLED_NOTICE } from './skill-commands'

// skills.md, "Inject dynamic context": with `disableSkillShellExecution`, "each command is replaced
// with `[shell command execution disabled by policy]` instead of being run" — inline `!` commands
// and ```! blocks alike; bundled and managed skills are not affected.
const PLACEHOLDER = '[shell command execution disabled by policy]'
const dir = tempDirPerTest('skill-shell-policy-')

describe('the placeholder', () => {
  test('is the text the docs name', () => {
    expect(SKILL_SHELL_DISABLED_NOTICE).toBe(PLACEHOLDER)
  })

  test('replaces an inline command and a fenced block, and runs neither', async () => {
    const marker = join(dir(), 'ran')
    const content = [
      `Branch: !\`touch ${marker}\``,
      '```!',
      `touch ${marker}`,
      'echo second',
      '```',
      'after',
    ].join('\n')
    const out = await expandSkillContent(content, dir(), {}, undefined, undefined, undefined, true)
    expect(out).toBe(`Branch: ${PLACEHOLDER}\n${PLACEHOLDER}\nafter`)
    expect(existsSync(marker)).toBe(false)
  })

  test('is not asked of the permission rules: nothing runs, so nothing can be denied', async () => {
    const asked: string[] = []
    const out = await expandSkillContent(
      'Go: !`rm -rf x`',
      dir(),
      {},
      undefined,
      (command) => (asked.push(command), 'denied'),
      undefined,
      true,
    )
    expect(out).toBe(`Go: ${PLACEHOLDER}`)
    expect(asked).toEqual([])
  })

  test('does not touch text that is not a command', async () => {
    const out = await expandSkillContent(
      'Say hi! `code` and !not',
      dir(),
      {},
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(out).toBe('Say hi! `code` and !not')
  })
})

describe('a plugin command under the policy', () => {
  test('shows the placeholder to the model and runs nothing', async () => {
    const marker = join(dir(), 'ran2')
    const out = await renderPluginPrompt(`Run: !\`touch ${marker}\``, {}, '', {
      cwd: dir(),
      shellDisabled: true,
    })
    expect(out).toBe(`Run: ${PLACEHOLDER}`)
    expect(existsSync(marker)).toBe(false)
  })
})

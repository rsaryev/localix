import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { bindShellArgs } from './skill-command-args'
import { expandSkillContent, SkillCommandPermissionError } from './skill-commands'

const dir = tempDirPerTest('skill-command-args-')

/**
 * Arguments a person or the model typed reach an injected command as values, never as script
 * text — whatever quoting the skill's author put around the placeholder. The defect: each
 * argument was spliced in as a `'…'` word, so an authored `"$1"` or `'$ARGUMENTS'` broke the
 * quoting and the typed text ran as shell.
 */
describe('arguments in an injected command', () => {
  test('a placeholder inside authored double quotes stays a value', async () => {
    const marker = join(dir(), 'pwn1')
    const out = await expandSkillContent(
      '!`echo "$1"`',
      dir(),
      {},
      { raw: `x '$(touch ${marker})'` },
    )
    expect(existsSync(marker)).toBe(false)
    expect(out).toBe(`$(touch ${marker})`)
  })

  test('a placeholder inside authored single quotes stays a value', async () => {
    const marker = join(dir(), 'pwn2')
    const raw = `"a; touch ${marker}"`
    const out = await expandSkillContent("!`echo '$ARGUMENTS'`", dir(), {}, { raw })
    expect(existsSync(marker)).toBe(false)
    // Inside quotes `$ARGUMENTS` is the text as typed.
    expect(out).toBe(raw)
  })

  test('unquoted, each argument is one word; an unknown $NAME is the shell’s', async () => {
    const args = { raw: `alpha "b c"`, names: ['first'] }
    expect(
      await expandSkillContent(
        '!`printf "[%s]" $ARGUMENTS $first; printf "<$ZZ_OWN>"`',
        dir(),
        {
          ZZ_OWN: 'own',
        },
        args,
      ),
    ).toBe('[alpha][b c][alpha]<own>')
  })

  test('the script holds variable references; a permission rule reads the values', () => {
    const bound = bindShellArgs("run $0 '$1' \\$1", { raw: `a "b'c"` })
    expect(bound.command).toBe(`run "\${LOCALIX_SKILL_ARG_0}" ''"\${LOCALIX_SKILL_ARG_1}"'' \\$1`)
    expect(bound.env).toEqual({ LOCALIX_SKILL_ARG_0: 'a', LOCALIX_SKILL_ARG_1: "b'c" })
    expect(bound.display).toBe(`run 'a' ''b'\\''c'' \\$1`)
  })
})

// skills.md: "Claude Code checks each one against your permission rules first ... aborts the
// invocation with `Shell command permission check failed for pattern "..."`."
describe('the permission check on injected commands', () => {
  test('a refused command aborts the expansion before any command runs', async () => {
    const marker = join(dir(), 'ran')
    const asked: string[] = []
    const expansion = expandSkillContent(
      `!\`touch ${marker}\`\n!\`rm -rf $0\``,
      dir(),
      {},
      { raw: 'x' },
      (command) => (asked.push(command), command.startsWith('rm') ? 'denied' : undefined),
    )
    await expect(expansion).rejects.toBeInstanceOf(SkillCommandPermissionError)
    await expect(expansion).rejects.toThrow(
      'Shell command permission check failed for pattern "!`rm -rf $0`": denied',
    )
    expect(asked).toEqual([`touch ${marker}`, "rm -rf 'x'"])
    expect(existsSync(marker)).toBe(false)
  })
})

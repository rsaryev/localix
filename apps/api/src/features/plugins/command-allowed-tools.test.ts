import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { skillPermissionRules } from '../chat/runtime/run/permission-gate-build'
import { toolOverrideOptions } from '../chat/service/tool-override-options'
import { readPluginFolder } from './kit'

const dir = tempDirPerTest('command-allowed-tools-')

/** The rules a plugin command's run is pre-approved with, from its file on disk. */
async function grantsOf(frontmatter: string) {
  mkdirSync(join(dir(), 'commands'), { recursive: true })
  writeFileSync(
    join(dir(), 'commands', 'commit.md'),
    `---\n${frontmatter}\n---\n\nCommit the staged changes.`,
  )
  const [command] = (await readPluginFolder(dir())).commands
  return skillPermissionRules(toolOverrideOptions(command!)?.extraAllowedTools)
}

describe("a plugin command's allowed-tools", () => {
  test('a Bash(...) pattern pre-approves only the commands it names, not the whole shell', async () => {
    const grants = await grantsOf('allowed-tools: Bash(git add:*), Bash(git commit:*)')

    expect(grants.some((rule) => rule.permission === 'Bash' && rule.pattern === '*')).toBe(false)
    expect(grants.filter((rule) => rule.permission === 'Bash').length).toBeGreaterThan(0)
  })

  test('a bare tool name still pre-approves the tool', async () => {
    const grants = await grantsOf('allowed-tools: Read, Grep')

    expect(grants).toContainEqual({ action: 'allow', permission: 'Read', pattern: '*' })
    expect(grants).toContainEqual({ action: 'allow', permission: 'Search', pattern: '*' })
  })
})

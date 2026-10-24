import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { skillPermissionRules } from '../chat/runtime/run/permission-gate-build'
import { toolOverrideOptions } from '../chat/service/tool-override-options'
import { parseCommandFile } from './discovery-cc-files'

const dir = tempDirPerTest('command-allowed-tools-')

/** The rules a plugin command's run is pre-approved with, from its file on disk. */
async function grantsOf(frontmatter: string) {
  const file = join(dir(), 'commit.md')
  writeFileSync(file, `---\n${frontmatter}\n---\n\nCommit the staged changes.`)
  const command = await parseCommandFile(file)
  return skillPermissionRules(toolOverrideOptions(command!)?.extraAllowedTools)
}

describe("a plugin command's allowed-tools", () => {
  test('a Bash(...) pattern pre-approves only the commands it names, not the whole shell', async () => {
    const grants = await grantsOf('allowed-tools: Bash(git add:*), Bash(git commit:*)')

    expect(grants.some((rule) => rule.permission === 'bash' && rule.pattern === '*')).toBe(false)
    expect(grants.filter((rule) => rule.permission === 'bash').length).toBeGreaterThan(0)
  })

  test('a bare tool name still pre-approves the tool', async () => {
    const grants = await grantsOf('allowed-tools: Read, Grep')

    expect(grants).toContainEqual({ action: 'allow', permission: 'read', pattern: '*' })
    expect(grants).toContainEqual({ action: 'allow', permission: 'search', pattern: '*' })
  })
})

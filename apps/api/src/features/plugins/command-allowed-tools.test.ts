import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { withOuterRules } from '../agent-core/permission-verdict'
import { evaluate, extractCallFacts } from '../agent-core/permission-engine'
import { runOuterRules } from '../chat/runtime/run/claude-code-permissions'
import { withAllowedTools } from '../chat/runtime/run/permission-gate-build'
import { toolOverrideOptions } from '../chat/service/tool-override-options'
import { readPluginFolder } from './kit'

const dir = tempDirPerTest('command-allowed-tools-')

const ASK = [{ permission: '*', pattern: '*', action: 'ask' as const }]

/** Whether a plugin command's run is pre-approved for a call, from the command's file on disk. */
async function grantsOf(frontmatter: string) {
  mkdirSync(join(dir(), 'commands'), { recursive: true })
  writeFileSync(
    join(dir(), 'commands', 'commit.md'),
    `---\n${frontmatter}\n---\n\nCommit the staged changes.`,
  )
  const [command] = (await readPluginFolder(dir())).commands
  const allowed = toolOverrideOptions(command!)?.extraAllowedTools
  const grants = withAllowedTools(runOuterRules(dir(), '/home/me'), allowed)
  return (toolName: string, input: object) =>
    withOuterRules(
      evaluate(
        ASK,
        { name: toolName, effect: 'external' },
        extractCallFacts(toolName, input, dir()),
      ),
      grants.judge({ toolName, input, tool: undefined }),
    ).action
}

describe("a plugin command's allowed-tools", () => {
  test('a Bash(...) pattern pre-approves only the commands it names, not the whole shell', async () => {
    const grants = await grantsOf('allowed-tools: Bash(git add:*), Bash(git commit:*)')

    expect(grants('Bash', { command: 'git add a.ts' })).toBe('allow')
    expect(grants('Bash', { command: 'rm -rf x' })).toBe('ask')
  })

  test('a bare tool name still pre-approves the tool', async () => {
    const grants = await grantsOf('allowed-tools: Read, Grep')

    expect(grants('Read', { path: 'a.ts' })).toBe('allow')
    expect(grants('Search', { pattern: 'x' })).toBe('allow')
  })
})

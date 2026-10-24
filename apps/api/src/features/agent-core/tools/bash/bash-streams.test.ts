import { describe, expect, test } from 'bun:test'

import { createBashTool } from './bash'
import type { BashToolDetails } from './bash-types'

describe('bash keeps stdout and stderr apart for a PostToolUse hook', () => {
  const tool = createBashTool(undefined, process.cwd())

  test('a command that writes to stderr reports each stream on its own', async () => {
    const r = await tool.execute('s1', { command: 'echo out; echo err >&2' })
    const details = r.details as BashToolDetails
    expect(details.stdout).toBe('out')
    expect(details.stderr).toBe('err')
  })

  test('a command with no stderr carries only the merged output', async () => {
    const r = await tool.execute('s2', { command: 'echo out' })
    expect((r.details as BashToolDetails).stderr).toBeUndefined()
  })
})

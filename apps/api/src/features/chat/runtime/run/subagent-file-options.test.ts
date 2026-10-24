import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { parseAgentFile } from '../../../plugins/discovery-cc-files'
import { buildLoadedAgent } from '../../../plugins/loader-contract'
import { subagentRunOptions } from './subagent-file-options'

// sub-agents.md, "Frontmatter reference": `omitClaudeMd` starts the subagent "without the user,
// project, and local CLAUDE.md files"; `autoCompactWindow` lowers its auto-compact window (100000
// to 1000000); `memory` gives it a persistent directory whose `MEMORY.md` (first 200 lines or
// 25KB) is in its system prompt, with Read, Write and Edit enabled.
describe('an agent file’s run options', () => {
  const dir = tempDirPerTest('subagent-options-')

  test('omitClaudeMd, autoCompactWindow and memory are read and applied', async () => {
    const file = join(dir(), 'agents', 'reviewer.md')
    await fs.mkdir(join(dir(), 'agents'), { recursive: true })
    await fs.writeFile(
      file,
      '---\nname: reviewer\ndescription: Reviews\ntools: Grep\nomitClaudeMd: true\nautoCompactWindow: 150000\nmemory: project\n---\nReview.',
    )
    const agent = buildLoadedAgent('kit', (await parseAgentFile(file))!, (t) => t)
    expect(agent).toMatchObject({
      omitClaudeMd: true,
      autoCompactWindow: 150000,
      memory: 'project',
    })

    const project = join(dir(), 'repo')
    const memoryDir = join(project, '.claude', 'agent-memory', 'reviewer')
    await fs.mkdir(memoryDir, { recursive: true })
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`)
    await fs.writeFile(join(memoryDir, 'MEMORY.md'), lines.join('\n'))
    const options = await subagentRunOptions(agent, {
      projectDir: project,
      homeDir: join(dir(), 'home'),
    })
    expect(options.contextLimit).toBe(150000)
    expect(options.instructions).toContain(memoryDir)
    expect(options.instructions).toContain('line 200')
    expect(options.instructions).not.toContain('line 201')
    expect(options.enableTools).toEqual(['read', 'write', 'edit'])
  })
})

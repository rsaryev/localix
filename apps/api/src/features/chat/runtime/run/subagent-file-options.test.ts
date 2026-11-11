import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { testCatalogAgent } from '../../../plugins/kit/testing'
import { subagentRunOptions } from './subagent-file-options'

// sub-agents.md, "Frontmatter reference": `autoCompactWindow` lowers its auto-compact window;
// `memory` gives it a persistent directory whose `MEMORY.md` (first 200 lines or 25KB) is in its
// system prompt, with Read, Write and Edit enabled. The kit plans the memory (`agentMemory`).
describe('an agent file’s run options', () => {
  const dir = tempDirPerTest('subagent-options-')
  const context = (on = true) => ({
    projectDir: join(dir(), 'repo'),
    homeDir: join(dir(), 'home'),
    configDir: join(dir(), 'config'),
    autoMemoryEnabled: () => on,
  })

  test('autoCompactWindow and memory are applied', async () => {
    const memoryDir = join(dir(), 'repo', '.claude', 'agent-memory', 'reviewer')
    await fs.mkdir(memoryDir, { recursive: true })
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`)
    await fs.writeFile(join(memoryDir, 'MEMORY.md'), lines.join('\n'))
    const agent = testCatalogAgent('reviewer', { autoCompactWindow: 150000, memory: 'project' })
    const options = await subagentRunOptions(agent, context())
    expect(options.contextLimit).toBe(150000)
    expect(options.memoryDir).toBe(memoryDir)
    expect(options.instructions).toContain('line 200')
    expect(options.instructions).not.toContain('line 201')
    expect(options.enableTools).toEqual(['Read', 'Write', 'Edit'])
  })

  test('a user memory lives in the configuration folder, named by the full agent type', async () => {
    const agent = testCatalogAgent('kit:reviewer', { memory: 'user' })
    const options = await subagentRunOptions(agent, context())
    expect(options.memoryDir).toBe(join(dir(), 'config', 'agent-memory', 'kit-reviewer'))
    expect(options.instructions).toContain('MEMORY.md does not exist yet.')
  })

  test('a plugin agent’s memory in the folder of its bare name is copied to its own once', async () => {
    const earlier = join(dir(), 'repo', '.claude', 'agent-memory', 'reviewer')
    await fs.mkdir(earlier, { recursive: true })
    await fs.writeFile(join(earlier, 'MEMORY.md'), 'kept from before')
    const agent = testCatalogAgent('kit:reviewer', { memory: 'project' })
    const options = await subagentRunOptions(agent, context())
    const own = join(dir(), 'repo', '.claude', 'agent-memory', 'kit-reviewer')
    expect(options.memoryDir).toBe(own)
    expect(options.instructions).toContain('kept from before')
    expect(await fs.readFile(join(earlier, 'MEMORY.md'), 'utf8')).toBe('kept from before')
    await fs.writeFile(join(own, 'MEMORY.md'), 'newer')
    await fs.writeFile(join(earlier, 'MEMORY.md'), 'other agent')
    expect((await subagentRunOptions(agent, context())).instructions).toContain('newer')
  })

  test('with auto memory off the agent has no memory', async () => {
    const options = await subagentRunOptions(
      testCatalogAgent('r', { memory: 'user' }),
      context(false),
    )
    expect(options).toEqual({ enableTools: [] })
  })
})

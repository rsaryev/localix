import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { loadFileSubagentTypes } from './file-subagent-types'

// sub-agents.md, "Choose the subagent scope": `.claude/agents/` (project, discovered by walking up
// from the working directory to the repository root, the closest definition winning) over
// `~/.claude/agents/` (user), both scanned recursively; identity comes only from `name`, and a file
// without a `name` or a `description` is skipped.
describe('agent files where Claude Code keeps them', () => {
  const base = tempDirPerTest('file-agents-')
  const agent = (name: string, description: string, extra = '') =>
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\nYou are ${name}.`
  const write = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
  }

  test('project and user agents are subagent types, the nearest definition winning', async () => {
    const home = join(base(), 'home')
    const repo = join(base(), 'repo')
    const pkg = join(repo, 'packages', 'web')
    await fs.mkdir(join(repo, '.git'), { recursive: true })
    await fs.mkdir(pkg, { recursive: true })
    await write(
      join(repo, '.claude', 'agents', 'review', 'reviewer.md'),
      agent('reviewer', 'root reviewer', 'tools: Read, Grep\nmodel: haiku\n'),
    )
    await write(join(pkg, '.claude', 'agents', 'reviewer.md'), agent('reviewer', 'web reviewer'))
    await write(join(home, '.claude', 'agents', 'helper.md'), agent('helper', 'my helper'))
    await write(join(home, '.claude', 'agents', 'reviewer.md'), agent('reviewer', 'user reviewer'))
    await write(join(repo, '.claude', 'agents', 'notes.md'), '# Just notes')
    await write(join(repo, '.claude', 'agents', 'nodesc.md'), '---\nname: nodesc\n---\nBody.')

    const types = await loadFileSubagentTypes(pkg, home)
    expect(types.map((t) => [t.fullName, t.description])).toEqual([
      ['reviewer', 'web reviewer'],
      ['helper', 'my helper'],
    ])
    const root = await loadFileSubagentTypes(repo, home)
    expect(root.find((t) => t.name === 'reviewer')).toMatchObject({
      description: 'root reviewer',
      prompt: 'You are reviewer.',
      tools: ['read', 'search'],
      preferredModel: 'haiku',
    })
  })
})

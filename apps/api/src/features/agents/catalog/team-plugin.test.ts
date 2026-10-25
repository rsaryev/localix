import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { scanAgentFolder } from './agent-file'

const TEAM = join(import.meta.dir, '../../../../../../plugins/team')

// The starter team is a plugin in the `localix` marketplace, not a seed: its agent files are read
// as any Claude Code agent file is, each with a name and a description.
test('the team plugin ships the five starter agents as Claude Code agent files', async () => {
  const agents = await scanAgentFolder(TEAM, 'user', '')
  expect(agents.map((agent) => agent.name).sort()).toEqual([
    'architect',
    'backend',
    'design',
    'devops',
    'frontend',
  ])
  for (const agent of agents) {
    expect(agent.description.length).toBeGreaterThan(10)
    expect(agent.prompt).toStartWith('You are ')
  }
})

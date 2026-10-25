import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { readAgentFile } from './catalog/agent-file'
import { agentFilePath, agentFileText, readAgentFileText, writeAgentFile } from './file-writer'
import { recordOf } from './projection'

describe('agent file writer', () => {
  const dir = tempDirPerTest('agent-writer-')

  const roundTrip = async (input: Parameters<typeof agentFileText>[1], existing = '') => {
    const path = agentFilePath(join(dir(), 'agents'), input.handle)
    await writeAgentFile(path, agentFileText(existing, input))
    const read = await readAgentFile(path, 'user', '')
    return { path, record: recordOf(read!, 'id') }
  }

  test('a definition survives the file: route, effort, turns, skills, priority and memory', async () => {
    const { record } = await roundTrip({
      handle: 'reviewer',
      description: 'Use when: reviewing',
      instructions: 'Review the diff.',
      leadershipPriority: 1,
      modelPreference: { provider: 'openai', model: 'gpt-4o', effort: 'max' },
      limits: { maxTurns: 7 },
      context: { preloadSkills: ['lint'], memory: { scope: 'project' } },
    })
    expect(record).toMatchObject({
      handle: 'reviewer',
      description: 'Use when: reviewing',
      instructions: 'Review the diff.',
      leadershipPriority: 1,
      modelPreference: { provider: 'openai', model: 'gpt-4o', effort: 'max' },
      limits: { maxTurns: 7 },
      context: { preloadSkills: ['lint'], memory: { scope: 'project' } },
    })
  })

  test('a route Claude Code cannot run stays out of its own keys', async () => {
    const { path } = await roundTrip({
      handle: 'a',
      description: 'd',
      instructions: 'x',
      leadershipPriority: 0,
      modelPreference: { provider: 'openai', model: 'gpt-4o', effort: 'high' },
    })
    const text = await readAgentFileText(path)
    expect(text).toContain('model: inherit')
    expect(text).toContain('effort: high')
    expect(text).toContain('model: openai/gpt-4o')
  })

  test('saving keeps the keys, comments and order Localix does not model', async () => {
    const existing = [
      '---',
      '# hand written',
      'name: a',
      'description: old',
      'tools: Read, Grep # keep',
      'color: blue',
      '---',
      'old body',
    ].join('\n')
    const { path } = await roundTrip(
      { handle: 'a', description: 'new', instructions: 'new body', leadershipPriority: 0 },
      existing,
    )
    const text = await readAgentFileText(path)
    expect(text).toContain('# hand written')
    expect(text).toContain('tools: Read, Grep # keep')
    expect(text).toContain('color: blue')
    expect(text).toContain('description: new')
    expect(text.trim().endsWith('new body')).toBe(true)
  })

  test('a field cleared in the Definition leaves the file', async () => {
    const first = agentFileText('', {
      handle: 'a',
      description: 'd',
      instructions: 'x',
      leadershipPriority: 2,
      limits: { maxTurns: 3 },
    })
    const second = agentFileText(first, {
      handle: 'a',
      description: 'd',
      instructions: 'x',
      leadershipPriority: 0,
    })
    expect(second).not.toContain('maxTurns')
    expect(second).not.toContain('localix')
  })
})

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { scopeAgents } from '../plugins/kit'
import { diskPluginHost } from '../plugins/kit/testing'
import { agentFilePath, agentFileText, readAgentFileText, writeAgentFile } from './file-writer'
import { recordOf } from './projection'

describe('agent file writer', () => {
  const dir = tempDirPerTest('agent-writer-')

  const roundTrip = async (input: Parameters<typeof agentFileText>[1], existing = '') => {
    const home = join(dir(), 'home')
    const path = agentFilePath(join(home, '.claude', 'agents'), input.name)
    await writeAgentFile(path, agentFileText(existing, input))
    // Read back as the catalog reads it: by the kit, from the person's agents folder.
    const managedDirectory = join(dir(), 'managed')
    const catalog = await scopeAgents(diskPluginHost(home, { managedDirectory }), {
      cwd: '/',
      homeDir: home,
      plugins: [],
      managed: { dir: managedDirectory },
    })
    const read = catalog.agents.find((agent) => agent.path === path)!
    return { path, record: recordOf({ ...read, projectId: '', bodyHash: '' }, 'id') }
  }

  test('a definition survives the file: turns and skills', async () => {
    const { record } = await roundTrip({
      name: 'reviewer',
      description: 'Use when: reviewing',
      instructions: 'Review the diff.',
      maxTurns: 7,
      skills: ['lint'],
    })
    expect(record).toMatchObject({
      name: 'reviewer',
      description: 'Use when: reviewing',
      instructions: 'Review the diff.',
      maxTurns: 7,
      skills: ['lint'],
    })
  })

  test('a definition never writes a model, an effort or a localix key', async () => {
    const { path } = await roundTrip({ name: 'a', description: 'd', instructions: 'x' })
    const text = await readAgentFileText(path)
    expect(text).not.toMatch(/^(model|effort|localix):/m)
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
      { name: 'a', description: 'new', instructions: 'new body' },
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
      name: 'a',
      description: 'd',
      instructions: 'x',
      maxTurns: 3,
    })
    const second = agentFileText(first, {
      name: 'a',
      description: 'd',
      instructions: 'x',
    })
    expect(second).not.toContain('maxTurns')
    expect(second).not.toContain('localix')
  })
})

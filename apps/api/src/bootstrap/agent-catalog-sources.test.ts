import { expect, test } from 'bun:test'
import type { LoadedPluginAgent } from '../features/plugins/loader-contract'
import { withModAgents } from './agent-catalog-sources'

const agent = (plugin: string, name: string, prompt: string): LoadedPluginAgent => ({
  pluginName: plugin,
  name,
  fullName: `${plugin}:${name}`,
  label: name,
  description: name,
  prompt,
})

test('the agents mods registered join their plugin’s group, or make one', () => {
  const groups = withModAgents(
    [
      { plugin: 'lab', projectId: '', enabled: true, agents: [agent('lab', 'file', 'f')] },
      { plugin: 'lab', projectId: 'p', enabled: true, agents: [agent('lab', 'old', 'o')] },
    ],
    [
      { plugin: 'lab', agents: [agent('lab', 'runner', 'r'), agent('lab', 'file', 'mod wins')] },
      { plugin: 'solo', agents: [agent('solo', 'one', '1')] },
    ],
  )
  expect(groups).toEqual([
    {
      plugin: 'lab',
      projectId: '',
      enabled: true,
      agents: [agent('lab', 'runner', 'r'), agent('lab', 'file', 'mod wins')],
    },
    { plugin: 'lab', projectId: 'p', enabled: true, agents: [agent('lab', 'old', 'o')] },
    { plugin: 'solo', projectId: '', enabled: true, agents: [agent('solo', 'one', '1')] },
  ])
})

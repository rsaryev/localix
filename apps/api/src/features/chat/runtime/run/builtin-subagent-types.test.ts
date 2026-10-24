import { expect, test } from 'bun:test'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import { parseSessionProvenance, serializeSessionProvenance } from '../../session-provenance'
import { applyPluginSubagent } from './plugin-subagent'
import { withBuiltinSubagentTypes } from './builtin-subagent-types'

// sub-agents.md, "Built-in subagents": Explore (read-only search) and Plan (read-only research
// for planning) are always there, and a user, project or plugin agent of the same name replaces
// the built-in. A skill's `agent: Explore` or a delegation to `Explore` has to find one.
const child = (pluginAgent: string) =>
  parseSessionProvenance(
    serializeSessionProvenance({
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'call',
      depth: 1,
      pluginAgent,
    }),
  )

test('Explore and Plan are types, read-only, unless a plugin defines its own', () => {
  const types = withBuiltinSubagentTypes([])
  expect(types.map((t) => t.fullName)).toEqual(['Explore', 'Plan'])
  const input = { agent: { instructions: 'You are Localix.' }, disabledTools: [] as string[] }
  const explore = applyPluginSubagent(input, child('Explore'), types)
  expect(explore?.disabledTools).toEqual(expect.arrayContaining(['write', 'edit']))
  expect(explore?.disabledTools).not.toContain('read')
  expect(explore?.agent.instructions).toContain('read-only')

  const mine: LoadedPluginAgent = {
    pluginName: 'kit',
    name: 'Explore',
    fullName: 'kit:Explore',
    label: 'Explore',
    description: 'My explorer',
    prompt: 'Explore cheaply.',
  }
  expect(withBuiltinSubagentTypes([mine]).map((t) => t.fullName)).toEqual(['kit:Explore', 'Plan'])
})

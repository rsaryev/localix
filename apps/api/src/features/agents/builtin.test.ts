import { describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_HANDLE } from '../../db/participant'
import { TOOL } from '../agent-core/tool-names'
import { BUILTIN_AGENTS, isBuiltinAgentName } from './builtin'

const byName = (name: string) => BUILTIN_AGENTS.find((record) => record.handle === name)

describe('the built-in agent roster', () => {
  test('the default handle names a real record', () => {
    // The handle itself is owned by `db/participant.ts`; what matters here is that it resolves
    // to an actual agent.
    expect(byName(DEFAULT_AGENT_HANDLE)).toBeDefined()
  })

  // Discovery marks a record `builtin` by this lookup; a user agent that happened to pass it
  // would be shown as shipped and lose its own editing affordances.
  test('recognizes the shipped handles and nothing else', () => {
    for (const record of BUILTIN_AGENTS) expect(isBuiltinAgentName(record.handle)).toBe(true)
    expect(isBuiltinAgentName('my-custom-agent')).toBe(false)
  })

  test('every built-in handle is a legal participant handle and unique', () => {
    const names = BUILTIN_AGENTS.map((record) => record.handle)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_-]*$/)
  })
})

describe('built-in instructions', () => {
  test("the default agent CARRIES the product's identity — it is not hidden in the runtime", () => {
    // The one copy of the text. It used to live in agent-core as `DEFAULT_AGENT_IDENTITY`
    // while this record shipped a blank persona meaning "look in the code", so the text a
    // user opened Settings to read was not there and the runtime kept an identity of its own
    // beside the registry.
    const persona = byName(DEFAULT_AGENT_HANDLE)?.instructions
    expect(persona).toContain('You are Localix Agent')
    // Who it is, not what seat it holds: leading is decided by priority and said only to the
    // leader, whichever agent that is.
    expect(persona).not.toMatch(/orchestrat|leader|team/i)
    expect(persona).not.toContain('visualization assistant')
  })

  test('Localix is the one shipped agent, and it leads by priority; the person ships beside it', () => {
    expect(BUILTIN_AGENTS.map((agent) => [agent.handle, agent.kind ?? 'agent'])).toEqual([
      ['localix', 'agent'],
      ['human', 'human'],
    ])
    expect(byName(DEFAULT_AGENT_HANDLE)?.leadershipPriority).toBe(2)
    expect(isBuiltinAgentName('backend')).toBe(false)
  })

  test('no shipped persona names a tool', () => {
    // A persona renders whatever tools the run holds, so a tool it names may not be there;
    // the prompt sections that name tools are gated on them, a persona cannot be.
    // A backticked name is a tool by construction; a bare one only when no English sentence
    // contains it by accident ("the vault", "write the words" are prose). `kanban_task_id` is
    // the parameter the pm persona once told every run to pass.
    for (const record of BUILTIN_AGENTS) {
      const text = `${record.handle}: ${record.instructions}`
      for (const name of Object.values(TOOL)) {
        expect(text).not.toContain(`\`${name}\``)
        if (name.includes('_')) expect(text).not.toMatch(new RegExp(`\\b${name}\\b`))
      }
      expect(text).not.toContain('kanban_task_id')
    }
  })
})

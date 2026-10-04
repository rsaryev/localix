import { describe, expect, test } from 'bun:test'

import {
  resolveParty,
  resolveSeatModel,
  routeCandidates,
  seedEffort,
} from './agent-route-resolution'
import type { SessionAgentRoute } from './repository-types'

const SEAT = { providerConnectionId: 'conn-s', modelId: 'm/session' }
const PROJECT = { providerConnectionId: 'conn-p', modelId: 'm/project' }
const RECENT_FOR_AGENT = { providerConnectionId: 'conn-r', modelId: 'm/recent-agent' }
const AGENT = { providerConnectionId: 'conn-a', modelId: 'm/agent' }

describe('which model a participant runs on', () => {
  test('the conversation wins when it states one', () => {
    const route = resolveSeatModel({ seat: SEAT, project: PROJECT, agent: AGENT })
    expect(route.modelId).toBe('m/session')
    expect(route.modelOrigin).toBe('session')
  })

  test('the agent default answers before any selection even when the project has a fallback', () => {
    const route = resolveSeatModel({ seat: null, project: PROJECT, agent: AGENT })
    expect(route.modelId).toBe('m/agent')
    expect(route.modelOrigin).toBe('agent')
  })

  test("the agent's latest selection outranks its settings-only default", () => {
    // A picker choice teaches routing but never rewrites the authored agent definition.
    const route = resolveSeatModel({ seat: null, recentForAgent: RECENT_FOR_AGENT, agent: AGENT })
    expect(route.modelId).toBe('m/recent-agent')
    expect(route.modelOrigin).toBe('recent')
  })

  test("the agent's latest selection also outranks a project default", () => {
    const route = resolveSeatModel({
      seat: null,
      project: PROJECT,
      recentForAgent: RECENT_FOR_AGENT,
      agent: AGENT,
    })
    expect(route.modelId).toBe('m/recent-agent')
    expect(route.modelOrigin).toBe('recent')
  })

  test("the agent's default answers before it has any selection history", () => {
    const route = resolveSeatModel({ seat: null, project: null, agent: AGENT })
    expect(route.modelId).toBe('m/agent')
    expect(route.modelOrigin).toBe('agent')
  })

  test('the project answers when the agent has no history or configured default', () => {
    const route = resolveSeatModel({ seat: null, project: PROJECT })
    expect(route.modelId).toBe('m/project')
    expect(route.modelOrigin).toBe('project')
  })

  test('a choice made for someone else is not a candidate for this agent', () => {
    const route = resolveSeatModel({ seat: null, agent: AGENT })
    expect(route.modelId).toBe('m/agent')
  })

  test('an empty string is not a choice', () => {
    // How "nothing chosen here" is stored. Treating it as a value is what made every seat
    // look decided and stopped the chain before it started.
    const route = resolveSeatModel({
      seat: { providerConnectionId: null, modelId: '' },
      project: PROJECT,
    })
    expect(route.modelId).toBe('m/project')
  })

  test('the connection travels with the model that won, never from a lower link', () => {
    // Pairing one link's model with another's credentials authenticates to the wrong provider.
    const route = resolveSeatModel({
      seat: { providerConnectionId: null, modelId: 'm/session' },
      project: PROJECT,
    })
    expect(route.providerConnectionId).toBeNull()
  })

  test('nothing configured anywhere is stated as unset, not invented', () => {
    const route = resolveSeatModel({ seat: null })
    expect(route.modelId).toBe('')
    expect(route.modelOrigin).toBe('unset')
  })
})

describe('the level a new seat is born on', () => {
  test('falls through the same order, independently of the model', () => {
    // Setting one thing must not silently unset another: a participant given a model and no
    // level takes the level from the next link rather than losing the model.
    expect(seedEffort(routeCandidates({ seat: SEAT, agent: { reasoningEffort: 'high' } }))).toBe(
      'high',
    )
  })

  test("the agent's latest selected level outranks its settings-only default", () => {
    expect(
      seedEffort(
        routeCandidates({
          recentForAgent: { reasoningEffort: 'max' },
          agent: { reasoningEffort: 'low' },
        }),
      ),
    ).toBe('max')
  })

  test('nothing anywhere is the flat default, not an absence', () => {
    expect(seedEffort(routeCandidates({}))).toBe('medium')
  })
})

describe('a whole party', () => {
  const party = [
    { agentId: 'builtin:lead', handle: 'lead', ...SEAT, reasoningEffort: 'low' },
    { agentId: 'builtin:qa', handle: 'qa', providerConnectionId: null, modelId: '' },
  ] as SessionAgentRoute[]

  test('resolves each member separately and keeps identity, order and level', () => {
    const resolved = resolveParty(party, {
      project: PROJECT,
      agent: (id) => (id === 'builtin:qa' ? AGENT : null),
    })
    expect(resolved.map((m) => [m.handle, m.modelId, m.modelOrigin])).toEqual([
      ['lead', 'm/session', 'session'],
      // qa chose nothing here and the project has a default, so the project answers before
      // qa's own card — the order is by how specific the choice is, not by who it is about.
      ['qa', 'm/agent', 'agent'],
    ])
    expect(resolved[0]?.reasoningEffort).toBe('low')
  })

  test('a member with no project default falls to its own card', () => {
    const resolved = resolveParty(party, {
      agent: (id) => (id === 'builtin:qa' ? AGENT : null),
    })
    expect(resolved[1]?.modelId).toBe('m/agent')
  })

  test('each member gets its OWN last choice, not the room’s', () => {
    const resolved = resolveParty(party, {
      recentForAgent: (id) => (id === 'builtin:qa' ? RECENT_FOR_AGENT : null),
      agent: () => AGENT,
    })
    expect(resolved[1]?.modelId).toBe('m/recent-agent')
  })

  test('an otherwise unconfigured participant uses the primary participant model', () => {
    const resolved = resolveParty(party, {})
    expect(resolved[1]).toMatchObject({
      modelId: 'm/session',
      providerConnectionId: 'conn-s',
      modelOrigin: 'primary',
    })
  })

  test('a room with no primary model leaves every unresolved participant unset', () => {
    const unresolved = party.map((member) => ({
      ...member,
      providerConnectionId: null,
      modelId: '',
    }))
    expect(resolveParty(unresolved, {}).map((member) => member.modelOrigin)).toEqual([
      'unset',
      'unset',
    ])
  })
})

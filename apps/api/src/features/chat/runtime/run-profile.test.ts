import { expect, test } from 'bun:test'
import { isToolDirect, resolveRunProfile } from '../../agent-core/run-shape'
import { resolveExecutionProfile } from './run-profile'

const session = { sessionKind: 'job' } as const
const legacy = resolveRunProfile(session, { prompt: 'Stale instructions', tools: ['write'] })

test('native host tools and registry instructions take precedence over a compatibility profile', () => {
  const profile = resolveExecutionProfile(session, 'Current instructions', {
    hostTools: ['read'],
    profileOverride: legacy,
  })
  expect(profile.prompt.identity).toBe('Current instructions')
  expect(isToolDirect(profile, 'read')).toBe(true)
  expect(isToolDirect(profile, 'write')).toBe(false)
  expect(legacy.prompt.identity).toBe('Stale instructions')
})

test('an empty native roster cannot be bypassed by a compatibility profile', () => {
  const profile = resolveExecutionProfile(session, 'Current instructions', {
    hostTools: [],
    profileOverride: legacy,
  })
  expect(isToolDirect(profile, 'write')).toBe(false)
  expect(isToolDirect(profile, 'bash')).toBe(false)
  expect(profile.prompt.identity).toBe('Current instructions')
})

test('external compatibility remains isolated to runs without native host tools', () => {
  expect(
    resolveExecutionProfile(session, 'Registry instructions', { profileOverride: legacy }),
  ).toBe(legacy)
})

test('ordinary native runs derive instructions without an override', () => {
  expect(resolveExecutionProfile(session, 'Registry instructions', {}).prompt.identity).toBe(
    'Registry instructions',
  )
})

test('only delegated teams acquire the handoff protocol, including a closed host roster', () => {
  for (const hostTools of [undefined, [], ['read']]) {
    const team = resolveExecutionProfile({ sessionKind: 'subagent', agents: [{}, {}] }, undefined, {
      hostTools,
    })
    expect(isToolDirect(team, 'conversation_control')).toBe(true)
    expect(isToolDirect(team, 'ask')).toBe(false)
    expect(isToolDirect(team, 'jobs')).toBe(false)
    const solo = resolveExecutionProfile({ sessionKind: 'subagent', agents: [{}] }, undefined, {
      hostTools,
    })
    expect(isToolDirect(solo, 'conversation_control')).toBe(false)
  }
})

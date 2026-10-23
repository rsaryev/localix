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

const child = { sessionKind: 'subagent' } as const

test('a child run as a plugin agent type without a tools list inherits the conversation’s tools', () => {
  const profile = resolveExecutionProfile(child, 'Plugin body', {}, {})
  expect(profile.openToolset).toBe(true)
  expect(profile.inheritsConversation).toBe(true)
  expect(profile.declaredTools).toBeNull()
  // Any other child, and a job, keep the closed surface their shape gives them.
  expect(resolveExecutionProfile(child, 'Registry body', {}).openToolset).toBe(false)
  expect(resolveExecutionProfile(session, 'Plugin body', {}, {}).openToolset).toBe(false)
})

test('a plugin agent type’s tools list is the exact allowlist, narrowed by a host roster', () => {
  const profile = resolveExecutionProfile(child, 'Plugin body', {}, { tools: ['read'] })
  expect(Object.keys(profile.toolExposure).sort()).toEqual(['read', 'tool_output'])
  expect(profile.openToolset).toBe(false)
  for (const name of ['browser', 'codemode', 'vault', 'context_budget'] as const)
    expect(isToolDirect(profile, name)).toBe(false)
  const narrowed = resolveExecutionProfile(
    child,
    'Plugin body',
    { hostTools: ['read'] },
    { tools: ['read', 'bash'] },
  )
  expect(narrowed.declaredTools).toEqual(['read'])
})

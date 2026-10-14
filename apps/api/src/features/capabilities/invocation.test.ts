import { describe, expect, test } from 'bun:test'
import { createInvocationRegistry, InvocationRegistry } from './invocation'
import { builtinAgentPreset } from './builtin-agent-presets'

describe('registered invocation hosts', () => {
  test('unknown hosts deny even beneath an allow wildcard', () => {
    const registry = createInvocationRegistry()
    const rules = [{ action: 'invocation:*', resource: '*', effect: 'allow' as const }]
    expect(registry.verdict(rules, 'chat', 'agent-a').effect).toBe('allow')
    expect(registry.verdict(rules, 'unregistered', 'agent-a').effect).toBe('deny')
  })

  test('same handle with a different identity inherits no invocation grant', () => {
    const registry = createInvocationRegistry()
    const rules = builtinAgentPreset('localix')
    expect(registry.verdict(rules, 'chat', 'builtin:localix').effect).toBe('allow')
    expect(registry.verdict(rules, 'chat', 'project-lead').effect).toBe('deny')
  })

  test('a later rule narrows a host the preset had opened', () => {
    // The list is ordered and the last match decides, so withdrawing one host from a shipped
    // role is a row appended to its own list — not a statement in some scope above it.
    const registry = createInvocationRegistry()
    for (const effect of ['ask', 'deny'] as const) {
      const rules = [
        ...builtinAgentPreset('localix'),
        { action: 'invocation:chat', resource: 'builtin:localix', effect },
      ]
      expect(registry.verdict(rules, 'chat', 'builtin:localix').effect).toBe(effect)
    }
  })

  test('an invocation host nothing mentions is denied', () => {
    // `deny` is the fallback for invocation specifically: being invocable is a grant, and a
    // role that never said so must not become reachable because a host was added.
    const registry = createInvocationRegistry()
    expect(registry.verdict([], 'chat', 'builtin:localix').effect).toBe('deny')
  })

  test('unload is idempotent and cannot remove a replacement registration', () => {
    const registry = new InvocationRegistry()
    const host = { id: 'extension.job', label: 'Extension job' }
    const dispose = registry.register(host)
    expect(() => registry.register(host)).toThrow(/duplicate/)
    dispose()
    registry.register(host)
    dispose()
    expect(registry.list()).toHaveLength(1)
  })
})

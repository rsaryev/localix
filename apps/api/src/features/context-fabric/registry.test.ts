import { describe, expect, test } from 'bun:test'
import { createContextProviderRegistry } from './registry'

const resolver = {
  id: 'files',
  version: '1',
  supports: () => true,
  estimate: async () => ({ bytes: 0 }),
  resolve: async () => [],
}

describe('ContextProviderRegistry', () => {
  test('rejects duplicate provider versions and unregisters cleanly', () => {
    const registry = createContextProviderRegistry()
    const contribution = {
      provider: resolver,
      destinations: ['chat'] as const,
      activation: 'explicit' as const,
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project' as const,
    }
    const unregister = registry.register(contribution)
    expect(() => registry.register(contribution)).toThrow('Duplicate context provider')
    expect(registry.resolvers('chat')).toHaveLength(1)
    unregister()
    expect(registry.list()).toHaveLength(0)
  })

  test('orders a plugin resolver before a generic fallback registered earlier', () => {
    const registry = createContextProviderRegistry()
    const envelope = {
      destinations: ['inline-completion'] as const,
      activation: 'explicit' as const,
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project' as const,
    }
    // Core's bridge registers at boot, before any plugin loads.
    registry.register({ ...envelope, provider: { ...resolver, id: 'generic' }, fallback: true })
    registry.tryRegister({ ...envelope, provider: { ...resolver, id: 'db' } }, 'database')
    expect(registry.resolvers('inline-completion').map((entry) => entry.provider.id)).toEqual([
      'db',
      'generic',
    ])
  })

  test('holds plugins to the plugin quota while core may declare its own ceiling', () => {
    const registry = createContextProviderRegistry()
    const envelope = {
      destinations: ['chat'] as const,
      activation: 'explicit' as const,
      defaultEnabled: true,
      maxTokens: 64_000,
      timeoutMs: 100,
      sensitivity: 'project' as const,
    }
    expect(registry.tryRegister({ ...envelope, provider: resolver }, 'plugin')).toMatchObject({
      status: 'rejected',
      reason: 'invalid_metadata',
    })
    expect(() =>
      registry.register({ ...envelope, provider: { ...resolver, id: 'host' } }),
    ).not.toThrow()
  })

  test('rejects automatic declarations that exceed provider destinations or sensitivity', () => {
    const registry = createContextProviderRegistry()
    const provider = {
      id: 'auto',
      version: '1',
      destinations: ['edit-prediction'] as const,
      sensitivity: 'project' as const,
      provide: async () => [],
    }
    expect(() =>
      registry.register({
        provider,
        destinations: ['chat'],
        activation: 'automatic',
        defaultEnabled: true,
        maxTokens: 10,
        timeoutMs: 10,
        sensitivity: 'project',
      }),
    ).toThrow('invalid_destinations')
    expect(() =>
      registry.register({
        provider,
        destinations: ['edit-prediction'],
        activation: 'automatic',
        defaultEnabled: true,
        maxTokens: 10,
        timeoutMs: 10,
        sensitivity: 'sensitive',
      }),
    ).toThrow('invalid_sensitivity')
  })

  test('tryRegister degrades a malformed plugin contribution to a content-free diagnostic', () => {
    const registry = createContextProviderRegistry()
    // Over the hard token ceiling → rejected without throwing.
    const diagnostic = registry.tryRegister(
      {
        provider: resolver,
        destinations: ['chat'],
        activation: 'explicit',
        defaultEnabled: true,
        maxTokens: 1_000_000,
        timeoutMs: 100,
        sensitivity: 'project',
      },
      'evil-plugin',
    )
    expect(diagnostic.status).toBe('rejected')
    expect(diagnostic.reason).toBe('invalid_metadata')
    expect(diagnostic.source).toBe('evil-plugin')
    expect(registry.list()).toHaveLength(0)
    // The diagnostic never carries produced content — only enumerated metadata.
    expect(Object.keys(diagnostic).sort()).toEqual(
      [
        'activation',
        'defaultEnabled',
        'destinations',
        'providerId',
        'providerVersion',
        'reason',
        'source',
        'status',
      ].sort(),
    )
  })

  test('tryRegister records a registered diagnostic and enforces namespace uniqueness', () => {
    const registry = createContextProviderRegistry()
    const contribution = {
      provider: resolver,
      destinations: ['chat'] as const,
      activation: 'explicit' as const,
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project' as const,
    }
    const ok = registry.tryRegister(contribution, 'plugin-a')
    expect(ok.status).toBe('registered')
    // A different plugin re-using the same id@version is a namespace conflict, first wins.
    const conflict = registry.tryRegister(contribution, 'plugin-b')
    expect(conflict.status).toBe('rejected')
    expect(conflict.reason).toBe('namespace_conflict')
    expect(registry.resolvers('chat')).toHaveLength(1)
    expect(registry.diagnostics().filter((d) => d.status === 'registered')).toHaveLength(1)
  })

  test('copies registered destinations so caller mutation cannot expand routing', () => {
    const registry = createContextProviderRegistry()
    const destinations = ['edit-prediction'] as ('edit-prediction' | 'chat')[]
    registry.register({
      provider: {
        id: 'auto',
        version: '1',
        destinations: ['edit-prediction'] as const,
        sensitivity: 'project' as const,
        provide: async () => [],
      },
      destinations,
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 10,
      timeoutMs: 10,
      sensitivity: 'project',
    })
    destinations.push('chat')
    expect(registry.automaticProviders('chat')).toHaveLength(0)
    expect(registry.automaticProviders('edit-prediction')).toHaveLength(1)
  })
})

import { describe, expect, test } from 'bun:test'

import type {
  ContextContribution,
  ContextDestination,
  ContextReference,
} from '../features/context-fabric/contracts'
import { createContextManager } from '../features/context-fabric/manager'
import { createContextProviderRegistry } from '../features/context-fabric/registry'
import { createStoreWorkingContext } from './store-context'

const piece = (
  providerId: string,
  id: string,
  content: string,
  priority = 100,
): ContextContribution => ({
  id,
  providerId,
  providerVersion: '1',
  scope: 'project',
  kind: 'file',
  content,
  priority,
  sensitivity: 'project',
})

/** A resolver that reads every file reference as its label, for the destinations it declares. */
function files(id: string, destinations: ContextDestination[]) {
  return {
    provider: {
      id,
      version: '1',
      supports: (ref: ContextReference) => ref.kind === 'file',
      estimate: async () => ({ bytes: 10, tokens: 3 }),
      resolve: async (ref: ContextReference) => [
        piece(id, `${id}:${ref.id}`, `${id} read ${ref.presentation.label}`),
      ],
    },
    destinations,
    activation: 'explicit' as const,
    defaultEnabled: true,
    maxTokens: 1_000,
    timeoutMs: 1_000,
    sensitivity: 'project' as const,
  }
}

function workingContext(
  register: (registry: ReturnType<typeof createContextProviderRegistry>) => void,
) {
  const registry = createContextProviderRegistry()
  register(registry)
  return createStoreWorkingContext({
    contextManager: createContextManager(registry),
    workspace: {
      resolveSessionWorkspaceMetadata: async () => ({ rootPath: '/work' }) as never,
      getProfile: async () => ({}) as never,
      getProject: async () => null as never,
    },
  })
}

const tab = (label: string, origin: 'linked' | 'ambient') => ({
  kind: 'file',
  token: `@file:${label}`,
  label,
  origin,
})

describe('the working set a recommendation reads', () => {
  test('only providers that declare the recommendation destination add to it', async () => {
    const context = workingContext((registry) => {
      registry.register(files('everywhere', ['chat', 'recommendation']))
      registry.register(files('chat-only', ['chat']))
      registry.register({
        provider: {
          id: 'mini-app',
          version: '1',
          destinations: ['recommendation'],
          sensitivity: 'project',
          provide: async () => [piece('mini-app', 'board', 'a tasks board is open')],
        },
        destinations: ['recommendation'],
        activation: 'automatic',
        defaultEnabled: true,
        maxTokens: 100,
        timeoutMs: 100,
        sensitivity: 'project',
      })
    })

    const pieces = await context('u1', {
      sessionId: 's1',
      references: [tab('compose.yaml', 'linked')],
    })

    expect(pieces.map((item) => item.content).sort()).toEqual([
      'a tasks board is open',
      'everywhere read compose.yaml',
    ])
  })

  test('a tab that is only open ranks below a file the person linked', async () => {
    const context = workingContext((registry) => {
      registry.register(files('files', ['recommendation']))
    })

    const pieces = await context('u1', {
      sessionId: 's1',
      references: [tab('notes.md', 'ambient'), tab('Cargo.toml', 'linked')],
    })

    const linked = pieces.find((item) => item.content.includes('Cargo.toml'))!
    const open = pieces.find((item) => item.content.includes('notes.md'))!
    expect(linked.priority).toBeGreaterThan(open.priority)
  })

  test('each piece names the tab or chip it was read from; what a provider added names none', async () => {
    const context = workingContext((registry) => {
      registry.register(files('files', ['recommendation']))
      registry.register({
        provider: {
          id: 'mini-app',
          version: '1',
          destinations: ['recommendation'],
          sensitivity: 'project',
          provide: async () => [piece('mini-app', 'board', 'a tasks board is open')],
        },
        destinations: ['recommendation'],
        activation: 'automatic',
        defaultEnabled: true,
        maxTokens: 100,
        timeoutMs: 100,
        sensitivity: 'project',
      })
    })

    const pieces = await context('u1', {
      sessionId: 's1',
      references: [tab('notes.md', 'ambient'), tab('Cargo.toml', 'linked')],
    })

    const named = (text: string) => {
      const { label, linked } = pieces.find((item) => item.content.includes(text))!
      return { label, linked }
    }
    expect(named('Cargo.toml')).toEqual({ label: 'Cargo.toml', linked: true })
    expect(named('notes.md')).toEqual({ label: 'notes.md', linked: false })
    expect(named('tasks board')).toEqual({ label: undefined, linked: undefined })
  })
})

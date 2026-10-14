import { describe, expect, test } from 'bun:test'
import type { MessageContextBinding } from '@localixai/agent'
import { capabilityResourceUri } from '@localixai/plugin-sdk/navigation'

import {
  contextBindingsToModelAssets,
  resolveMessageBindings,
} from '../chat/service/message-bindings'
import type { ChatServiceDeps } from '../chat/service/context'
import { captureContextBindings } from '../context-fabric/binding-capture'
import type { ContextResolver } from '../context-fabric/contracts'
import { createContextManager } from '../context-fabric/manager'
import { createContextProviderRegistry } from '../context-fabric/registry'
import { createCapabilityContextProvider } from './context-provider'
import { createCapabilityResourceProvider } from './resource-provider'

const session = { id: 'session-1', projectId: 'project-1' }

describe('capability Context Fabric provider', () => {
  test('uses the standard resource-backed resolver contract without invocation authority', async () => {
    const contribution = createCapabilityContextProvider()
    const provider = contribution.provider as ContextResolver
    const uri = capabilityResourceUri({
      kind: 'skill',
      id: 'review',
      scope: 'project-1',
      label: 'Review',
      enabled: true,
    })
    const reference = {
      version: 1 as const,
      id: 'capability-reference',
      kind: 'resource',
      uri,
      presentation: { label: 'Review' },
      freshness: 'resolve-at-send' as const,
      scope: { userId: 'user-1', sessionId: session.id, projectId: session.projectId },
    }

    expect(contribution).toMatchObject({
      destinations: ['chat'],
      activation: 'explicit',
      sensitivity: 'public',
    })
    expect(provider.supports(reference, 'chat')).toBe(true)
    expect(
      provider.supports({ ...reference, uri: 'localix://resource/git/project-1/status' }, 'chat'),
    ).toBe(false)

    const [resolved] = await provider.resolve(
      reference,
      {
        destination: 'chat',
        userId: 'user-1',
        sessionId: session.id,
        projectId: session.projectId,
        maxBytes: 10_000,
      },
      new AbortController().signal,
    )
    expect(resolved).toMatchObject({
      providerId: 'capability-context',
      providerVersion: '1',
      kind: 'capability-resource',
      sensitivity: 'public',
      uri,
    })
    expect(resolved?.content).toContain('Capability: Review')
    expect(resolved?.content).toContain('Kind: skill')
  })

  test('resolves a linked capability through capture and onto the model wire without fallback', async () => {
    const resourceProvider = createCapabilityResourceProvider()
    const registry = createContextProviderRegistry()
    registry.register(createCapabilityContextProvider(resourceProvider))
    const manager = createContextManager(registry)
    const uri = capabilityResourceUri({
      kind: 'tool',
      id: 'ask',
      scope: 'project-1',
      label: 'Ask user',
      description: 'Request a decision from the user.',
      enabled: true,
    })
    const binding: MessageContextBinding = {
      kind: 'context',
      id: 'binding-1',
      source: 'drag',
      target: {
        kind: 'resource',
        token: `@resource:${uri}`,
        label: 'Ask user',
        uri,
      },
      resolution: { status: 'pending', contributions: [] },
    }
    const deps = {
      resolveContextBindings: async (
        userId: string,
        scopedSession: typeof session,
        bindings: readonly MessageContextBinding[],
      ) =>
        captureContextBindings(
          manager,
          {
            userId,
            session: scopedSession,
            bindings,
            maxBytes: 32_000,
            capturedAt: '2026-07-29T00:00:00.000Z',
          },
          new AbortController().signal,
        ),
    } as unknown as ChatServiceDeps

    const [resolved] = (await resolveMessageBindings(deps, 'user-1', session, [
      binding,
    ])) as MessageContextBinding[]
    const [asset] = contextBindingsToModelAssets([resolved])

    expect(resolved?.resolution).toMatchObject({
      status: 'resolved',
      capturedAt: '2026-07-29T00:00:00.000Z',
      contributions: [
        {
          providerId: 'capability-context',
          providerVersion: '1',
          kind: 'capability-resource',
          sensitivity: 'public',
        },
      ],
    })
    expect(asset?.kind).toBe('text')
    expect(asset?.text).toContain('--- Context (capability-resource; provider=capability-context@1')
    expect(asset?.text).toContain('Capability: Ask user')
    expect(asset?.text).toContain(
      'Link semantics: User-selected context only; linking does not enable or invoke this capability.',
    )
    expect(asset?.text).toContain(
      'Guidance: Use this capability only if it is available and relevant.',
    )
  })
})

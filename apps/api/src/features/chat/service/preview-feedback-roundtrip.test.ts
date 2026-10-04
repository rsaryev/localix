import { describe, expect, test } from 'bun:test'
import type { MessageContextBinding } from '@localixai/agent'

import { USER_PARTICIPANT } from '../../../db/participant'
import { serializeMessagePayload } from '../../../db/payload'
import { captureContextBindings } from '../../context-fabric/binding-capture'
import { createContextProviderRegistry } from '../../context-fabric/registry'
import { createContextManager } from '../../context-fabric/manager'
import { createHostRefResolver } from '../../context-fabric/host-ref-resolver'
import { expandContextRefs } from '../../projects/expand-refs'
import { sendMessageRequestSchema } from '../contracts/messages'
import { contextBindingsToModelAssets } from '../model-assets'
import { mapMessage } from '../repository-mappers'
import type { ChatServiceDeps } from './context'
import { resolveMessageBindings } from './message-bindings'

function previewBinding(id: string, note: string): MessageContextBinding {
  return {
    kind: 'context',
    id,
    source: 'plugin',
    target: {
      kind: 'snippet',
      token: '@snippet:Preview feedback',
      label: 'Preview feedback',
      attributes: {
        content: `Preview URL: http://localhost:3000\nSelected: button.submit\nFeedback: ${note}`,
        language: 'text',
        feedbackVersion: 1,
        feedbackNote: note,
        feedbackSummary: 'button.submit',
      },
    },
    assets: [
      { kind: 'image', name: 'preview.png', mediaType: 'image/png', mediaId: 'media-1', size: 12 },
    ],
    resolution: { status: 'pending', contributions: [] },
  }
}

describe('preview feedback API/history roundtrip', () => {
  test('accepts context-only sends but rejects an entirely empty send', () => {
    const bindings = [previewBinding('preview-1', 'Make this button larger')]
    expect(sendMessageRequestSchema.parse({ prompt: '', bindings })).toEqual({
      prompt: '',
      bindings,
    })
    expect(sendMessageRequestSchema.safeParse({ prompt: '', bindings: [] }).success).toBe(false)
  })

  test('preserves feedback, assets and distinct same-token captures after a history reload', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: createHostRefResolver((_userId, input) => expandContextRefs('', input.refs)),
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 100_000,
      timeoutMs: 1_000,
      sensitivity: 'project',
    })
    const manager = createContextManager(registry)
    const session = { id: 'session-1', projectId: 'project-1' }
    const deps = {
      resolveContextBindings: (
        userId: string,
        _session: unknown,
        bindings: readonly MessageContextBinding[],
      ) =>
        captureContextBindings(
          manager,
          {
            userId,
            session,
            bindings,
            capturedAt: '2026-10-01T00:00:00.000Z',
            maxBytes: 100_000,
          },
          new AbortController().signal,
        ),
    } as unknown as ChatServiceDeps
    const inputs = [
      previewBinding('preview-1', 'Make this button larger'),
      previewBinding('preview-2', 'Change its color'),
    ]
    const request = sendMessageRequestSchema.parse({ prompt: '', bindings: inputs })
    const bindings = await resolveMessageBindings(deps, 'user-1', session, request.bindings)
    const json = serializeMessagePayload({
      id: 'message-1',
      role: 'user',
      from: USER_PARTICIPANT,
      content: request.prompt,
      bindings,
    })
    const reload = () =>
      mapMessage({
        id: 'message-1',
        session_id: session.id,
        user_id: 'user-1',
        payload_json: json,
        created_at: '',
        updated_at: '',
      })
    const row = reload()
    expect(row.payload.content).toBe('')
    expect(row.payload.bindings).toEqual(bindings)
    const captured = row.payload.bindings as MessageContextBinding[]
    for (const [index, item] of captured.entries()) {
      expect(item.id).toBe(inputs[index]!.id)
      expect(item.target).toEqual(inputs[index]!.target)
      expect(item.assets).toEqual(inputs[index]!.assets)
      expect(item.resolution.status).toBe('resolved')
      expect(item.resolution.capturedAt).toBe('2026-10-01T00:00:00.000Z')
    }
    const modelAssets = contextBindingsToModelAssets(row.payload.bindings)
    expect(modelAssets).toHaveLength(2)
    expect(modelAssets[0]!.text).toContain('Make this button larger')
    expect(modelAssets[1]!.text).toContain('Change its color')
    expect(modelAssets[0]!.text).toContain('button.submit')
    expect(modelAssets[0]!.contextRef).toBe(true)
    expect(contextBindingsToModelAssets(reload().payload.bindings)).toEqual(modelAssets)
    expect(inputs.every((item) => item.resolution.status === 'pending')).toBe(true)
  })
})

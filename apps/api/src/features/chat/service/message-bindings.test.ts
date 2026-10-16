import { describe, expect, test } from 'bun:test'
import { systemContextSelectionBinding, type MessageContextBinding } from '@localixai/agent'

import type { ChatServiceDeps } from './context'
import { resolveMessageBindings } from './message-bindings'

const session = { id: 'session-1', projectId: 'project-1' }

function binding(id: string): MessageContextBinding {
  return {
    kind: 'context',
    id,
    source: 'active-tab',
    target: {
      kind: 'resource',
      token: '@resource:localix://resource/plugin/shared/resource',
      label: `Shared ${id}`,
      uri: 'localix://resource/plugin/shared/resource',
    },
    resolution: { status: 'pending', contributions: [] },
  }
}

describe('resolveMessageBindings', () => {
  test('preserves the model-empty system selection binding without resolving it', async () => {
    const selection = systemContextSelectionBinding('session-1', ['notice:model_change'])

    expect(
      await resolveMessageBindings({} as ChatServiceDeps, 'user-1', session, [selection]),
    ).toEqual([selection])
  })

  test('writes each resolution back to the binding with the same id', async () => {
    const seen: string[][] = []
    const deps = {
      resolveContextBindings: async (
        _userId: string,
        _session: unknown,
        bindings: readonly MessageContextBinding[],
      ) => {
        seen.push(bindings.map((item) => item.id))
        return new Map(
          bindings.map((item, index) => [
            item.id,
            {
              status: 'resolved' as const,
              contributions: [
                {
                  id: `c${index}`,
                  providerId: 'p',
                  providerVersion: '1',
                  scope: 'session' as const,
                  kind: 'resource',
                  content: `content ${item.id}`,
                  sensitivity: 'project' as const,
                },
              ],
            },
          ]),
        )
      },
    } as unknown as ChatServiceDeps

    const result = (await resolveMessageBindings(deps, 'user-1', session, [
      binding('binding-1'),
      binding('binding-2'),
    ])) as MessageContextBinding[]

    expect(seen).toEqual([['binding-1', 'binding-2']])
    expect(result.map((item) => item.resolution.contributions[0]?.content)).toEqual([
      'content binding-1',
      'content binding-2',
    ])
  })

  test('a deployment without a resolver marks bindings unsupported rather than dropping them', async () => {
    const result = (await resolveMessageBindings({} as ChatServiceDeps, 'user-1', session, [
      binding('binding-1'),
    ])) as MessageContextBinding[]
    expect(result).toHaveLength(1)
    expect(result[0]!.resolution).toEqual({ status: 'unsupported', contributions: [] })
  })
})

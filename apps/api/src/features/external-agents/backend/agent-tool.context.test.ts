import { expect, test } from 'bun:test'
import { createResourceContextProvider } from '@localixai/plugin-sdk/backend'
import { createExternalAgentResourceProvider, type ExternalAgentResourceService } from './resource-provider'
import { createExternalAgentSessionsTool } from './agent-tool'
import type { AgentSessionsService } from './service'
import type { TranscriptSlice } from '../shared/contracts'

test('linked context gives the core agent a key for deeper read-only investigation', async () => {
  const reads: unknown[][] = []
  const slice: TranscriptSlice = {
    key: 'codex:s1', summary: { key: 'codex:s1', provider: 'codex', nativeSessionId: 's1', title: 'Investigate parser', updatedAt: 1000, sourcePath: '/fixture/history.jsonl' },
    total: 2500, withheld: 2498,
    events: [
      { provider: 'codex', nativeSessionId: 's1', ordinal: 2498, role: 'assistant', text: 'Read parser', toolCallId: 'call', toolName: 'read_file' },
      { provider: 'codex', nativeSessionId: 's1', ordinal: 2499, role: 'tool', text: 'Parser accepts an empty identifier', toolCallId: 'call' },
    ],
  }
  const service = { transcript: async (...args: unknown[]) => { reads.push(args); return slice } } as unknown as AgentSessionsService
  const resource = createExternalAgentResourceProvider(service as ExternalAgentResourceService)
  const context = createResourceContextProvider({ id: 'external-agents:context', namespace: 'external-agents', expander: resource })
  if (!('resolve' in context.provider)) throw new Error('Linked resources need an explicit resolver')
  const reference = { version: 1 as const, id: 'linked', kind: 'resource', uri: 'localix://resource/external-agent/codex/s1', presentation: { label: 'Parser investigation' }, freshness: 'resolve-at-send' as const, scope: { userId: 'user', sessionId: 'own-chat' } }
  const request = { userId: 'user', sessionId: 'own-chat', destination: 'chat' as const, maxBytes: 3000 }
  const signal = new AbortController().signal
  expect(context.provider.supports(reference, 'chat')).toBe(true)
  const [captured] = await context.provider.resolve(reference, request, signal)
  expect(captured?.content).toContain('key: codex:s1')
  expect(captured?.content).toContain('external_agent_sessions')
  expect(captured?.content).toContain('raising "from"')
  expect(captured?.content).toContain('[tool:read_file]')
  expect(captured?.content.length).toBeLessThanOrEqual(3000)
  const tool = createExternalAgentSessionsTool(service, Promise.resolve(), 'own-chat')
  const deeper = await tool.execute('research', { action: 'transcript', key: 'codex:s1', from: 1500, maxEvents: 25 }, signal)
  expect(reads.at(-1)).toEqual(['codex:s1', 25, undefined, undefined, 1500])
  expect(deeper.content).toContain('Parser accepts an empty identifier')
  expect(tool.mutates).toBe(false)
  expect(context.provider.supports({ ...reference, uri: 'localix://resource/other/s1' }, 'chat')).toBe(false)
})

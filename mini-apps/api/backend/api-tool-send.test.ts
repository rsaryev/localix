import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineAgentTool, type AgentToolExecutionContext } from '@localixai/agent/agents'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { z } from 'zod'
import { createApiTool } from './api-tool'
import { createActiveEnvironmentStore } from './collection/active-environment'
import { createFileEnvironmentStore } from './collection/environments'
import { createCollectionStore } from './collection/store'
import { createFileEnvironmentService } from './environments/file-service'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'localix-api-tool-send-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  delete (globalThis as Record<string, unknown>).__localix_rest_api_client_history__
})

function toolFor(collectionRoot: string) {
  const store = createCollectionStore(collectionRoot)
  const environments = createFileEnvironmentService(
    createFileEnvironmentStore(collectionRoot),
    createActiveEnvironmentStore(path.join(root, 'state')),
    collectionRoot,
  )
  const ctx = {
    cwd: root,
    stateDir: path.join(root, 'state'),
    z,
    defineTool: defineAgentTool,
    config: {},
    helpers: {
      configNumber: (_value: unknown, fallback: number) => fallback,
      configBoolean: () => true,
      errorResult: (message: string) => ({ content: message, isError: true }),
    },
    ui: { offer: (details: unknown) => details },
  } as unknown as MiniAppContext
  return {
    tool: createApiTool({
      ctx,
      store,
      environments,
      resolveSecret: async () => null,
      userId: 'u',
    }),
    store,
  }
}

describe('api_client performs real HTTP requests', () => {
  test('an ad-hoc send reaches the endpoint and returns its response', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        return Response.json({
          reached: true,
          page: url.searchParams.get('page'),
        })
      },
    })
    try {
      const { tool } = toolFor(path.join(root, '.localix', 'api'))
      const result = await tool.execute('call-send', {
        action: 'send',
        url: `${server.url}items`,
        query: [{ name: 'page', value: '2' }],
      })

      expect(result.isError).toBeUndefined()
      expect(result.content).toContain('→ 200 OK')
      expect(result.content).toContain('"reached": true')
      expect(result.content).toContain('"page": "2"')
    } finally {
      await server.stop(true)
    }
  })

  test('save followed by send-by-name persists first and calls second', async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1
        return new Response('called')
      },
    })
    try {
      const { tool, store } = toolFor(path.join(root, '.localix', 'api'))
      const saved = await tool.execute('call-save', {
        action: 'save',
        name: 'checks/health',
        url: `${server.url}health`,
      })
      expect(saved.content).toContain('Saved only — no HTTP call was made')
      expect(calls).toBe(0)
      expect(await store.get('checks/health')).not.toBeNull()

      const commands: unknown[][] = []
      const execution = {
        session: {
          id: 'session-a',
          scratchDir: path.join(root, 'scratch'),
          emitData: () => {},
          emitCommand: (...args: unknown[]) => commands.push(args),
        },
      } as AgentToolExecutionContext
      const sent = await tool.execute(
        'call-saved-send',
        {
          action: 'send',
          name: 'checks/health',
        },
        undefined,
        undefined,
        execution,
      )
      expect(sent.isError).toBeUndefined()
      expect(sent.content).toContain('called')
      expect(calls).toBe(1)
      expect(commands).toEqual([
        ['api', 'workspace', { type: 'request_send', name: 'checks/health', phase: 'started' }],
        ['api', 'workspace', { type: 'request_send', name: 'checks/health', phase: 'completed' }],
      ])
    } finally {
      await server.stop(true)
    }
  })

  test('batches ordered save/send operations and deduplicates their navigation buttons', async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1
        return Response.json({ ok: true })
      },
    })
    try {
      const { tool, store } = toolFor(path.join(root, '.localix', 'api'))
      const result = await tool.execute('call-batch', {
        action: 'batch',
        operations: [
          { action: 'save', name: 'checks/health', url: `${server.url}health` },
          { action: 'send', name: 'checks/health', filter: '$.ok' },
          {
            action: 'save',
            name: 'checks/version',
            url: `${server.url}version`,
          },
          { action: 'send', name: 'checks/version', filter: '$.ok' },
        ],
      })

      expect(result.isError).toBeUndefined()
      expect(result.content).toContain('Batch completed: 4 succeeded, 0 failed.')
      expect(calls).toBe(2)
      expect(await store.get('checks/health')).not.toBeNull()
      expect(await store.get('checks/version')).not.toBeNull()
      expect(result.details).toMatchObject({
        type: 'ui.navigate.suggestions',
        suggestions: [
          { uri: 'localix://resource/api/checks%2Fhealth' },
          { uri: 'localix://resource/api/checks%2Fversion' },
        ],
      })
    } finally {
      await server.stop(true)
    }
  })
})

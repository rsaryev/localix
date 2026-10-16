import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineAgentTool, type AgentToolExecutionContext } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
import { z } from 'zod'

import { createApiTool } from './api-tool'
import { createActiveEnvironmentStore } from './collection/active-environment'
import { createFileEnvironmentStore } from './collection/environments'
import { createCollectionStore } from './collection/store'
import { createFileEnvironmentService } from './environments/file-service'
import type { EnvironmentService } from './environments/service'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'localix-api-tool-scope-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('agent saves and workbench reads one session collection', () => {
  test('save resolves the executing session before choosing the request file', async () => {
    const bootStore = createCollectionStore(path.join(root, 'boot', '.localix', 'api'))
    const sessionRoot = path.join(root, 'LOCALIX-849')
    const sessionStore = createCollectionStore(path.join(sessionRoot, '.localix', 'api'))
    const environments = {} as EnvironmentService
    const seenSessions: Array<string | undefined> = []
    const ctx = {
      cwd: path.join(root, 'boot'),
      stateDir: path.join(root, 'state'),
      z,
      defineTool: defineAgentTool,
      config: {},
      helpers: {
        configNumber: (_value: unknown, fallback: number) => fallback,
        configBoolean: (_value: unknown, fallback: boolean) => fallback,
        errorResult: (message: string) => ({ content: message, isError: true }),
      },
      ui: { offer: (details: unknown) => details },
    } as unknown as PluginContext
    const tool = createApiTool({
      ctx,
      store: bootStore,
      environments,
      resolveSecret: async () => null,
      userId: 'u',
      resolveScope: async (sessionId) => {
        seenSessions.push(sessionId)
        return { store: sessionStore, environments }
      },
    })
    const commands: unknown[][] = []
    const execution = {
      session: {
        id: 'LOCALIX-849',
        scratchDir: path.join(root, 'scratch'),
        emitData: () => {},
        emitCommand: (...args: unknown[]) => commands.push(args),
      },
    } as AgentToolExecutionContext

    const result = await tool.execute(
      'call-1',
      {
        action: 'save',
        name: 'agent-created',
        method: 'GET',
        url: 'https://httpbin.org/get',
      },
      undefined,
      undefined,
      execution,
    )

    expect(seenSessions).toEqual(['LOCALIX-849'])
    expect(result.content).toContain('Saved only — no HTTP call was made')
    expect((await sessionStore.list()).map((request) => request.name)).toEqual(['agent-created'])
    expect(await bootStore.list()).toEqual([])
    expect(
      await Bun.file(path.join(sessionRoot, '.localix/api/agent-created.request.json')).exists(),
    ).toBe(true)
    expect(commands).toEqual([
      ['api', 'workspace', { type: 'collection_changed', target: 'request', action: 'save' }],
    ])
  })

  test('a unified api_client environment save vaults a literal before it reaches disk', async () => {
    const bootStore = createCollectionStore(path.join(root, 'boot', '.localix', 'api'))
    const sessionRoot = path.join(root, 'LOCALIX-849')
    const collectionRoot = path.join(sessionRoot, '.localix', 'api')
    const sessionStore = createCollectionStore(collectionRoot)
    const secrets = new Map<string, string>()
    const sessionEnvironments = createFileEnvironmentService(
      createFileEnvironmentStore(collectionRoot),
      createActiveEnvironmentStore(path.join(root, 'state')),
      collectionRoot,
      {
        storeSecret: async (_userId, key, value) => {
          if (secrets.has(key)) return false
          secrets.set(key, value)
          return true
        },
        resolveSecret: async (_userId, key) => secrets.get(key) ?? null,
      },
    )
    const ctx = {
      cwd: path.join(root, 'boot'),
      stateDir: path.join(root, 'state'),
      z,
      defineTool: defineAgentTool,
      config: {},
      helpers: {
        configNumber: (_value: unknown, fallback: number) => fallback,
        configBoolean: (_value: unknown, fallback: boolean) => fallback,
        errorResult: (message: string) => ({ content: message, isError: true }),
      },
      ui: { offer: (details: unknown) => details },
    } as unknown as PluginContext
    const tool = createApiTool({
      ctx,
      store: bootStore,
      environments: sessionEnvironments,
      resolveSecret: async () => null,
      userId: 'u',
      resolveScope: async () => ({ store: sessionStore, environments: sessionEnvironments }),
    })
    const commands: unknown[][] = []
    const execution = {
      session: {
        id: 'LOCALIX-849',
        scratchDir: path.join(root, 'scratch'),
        emitData: () => {},
        emitCommand: (...args: unknown[]) => commands.push(args),
      },
    } as AgentToolExecutionContext

    const result = await tool.execute(
      'call-2',
      {
        action: 'save',
        target: 'environment',
        name: 'staging',
        variables: [{ name: 'token', value: 'literal-secret', secret: true }],
      },
      undefined,
      undefined,
      execution,
    )

    expect(result.isError).toBeUndefined()
    const text = await Bun.file(path.join(collectionRoot, 'environments/staging.json')).text()
    expect(text).not.toContain('literal-secret')
    expect(text).toContain('${secret:REST_ENV_STAGING_TOKEN}')
    expect(secrets.get('REST_ENV_STAGING_TOKEN')).toBe('literal-secret')
    expect(commands).toEqual([
      ['api', 'workspace', { type: 'collection_changed', target: 'environment', action: 'save' }],
    ])
  })
})

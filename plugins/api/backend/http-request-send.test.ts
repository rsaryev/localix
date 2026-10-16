import { expect, test } from 'bun:test'
import { defineAgentTool } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
import { z } from 'zod'
import { createHttpRequestTool } from './http-request'
import { createMemoryCollection } from './collection/memory'
import type { EnvironmentService } from './environments/service'

test.each(['store', 'environment', 'vault'] as const)(
  'keeps rejected %s operations inside the tool error boundary',
  async (stage) => {
    const message = `${stage} rejected for test`
    const store = createMemoryCollection()
    const ctx = {
      z,
      defineTool: defineAgentTool,
      config: {},
      helpers: {
        configNumber: (_value: unknown, fallback: number) => fallback,
        configBoolean: () => false,
        errorResult: (content: string) => ({ content, isError: true }),
      },
      ui: { offer: (details: unknown) => details },
    } as unknown as PluginContext
    const environments = {
      activeVars: async () => {
        if (stage === 'environment') throw new Error(message)
        return new Map<string, string>()
      },
    } as unknown as EnvironmentService
    const tool = createHttpRequestTool({
      ctx,
      userId: 'u',
      environments,
      store: {
        ...store,
        get: async () => {
          if (stage === 'store') throw new Error(message)
          return null
        },
      },
      resolveSecret: async () => {
        throw new Error(message)
      },
    })
    const out = await tool.execute('call', {
      action: 'send',
      ...(stage === 'store' ? { name: 'saved' } : {}),
      url: 'https://api.test',
      authType: 'bearer',
      token: '${secret:KEY}',
    })
    expect(out).toEqual({ content: message, isError: true })
  },
)

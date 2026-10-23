import { describe, expect, test } from 'bun:test'
import { defineAgentTool } from '@localixai/agent/agents'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { z } from 'zod'
import { createManageEnvironmentTool } from './manage-environment'
import type { EnvironmentService } from './environments/service'
import type { EnvironmentVariable } from './collection/environments'

describe('agent environment saves', () => {
  test('preserves secret:true through to the vault-aware environment service', async () => {
    let received: EnvironmentVariable[] = []
    const environments = {
      get: async () => null,
      save: async (_userId: string, name: string, variables: EnvironmentVariable[]) => {
        received = variables
        return {
          id: name,
          createdAt: 1,
          updatedAt: 1,
          active: true,
          variables: [{ name: 'token', value: '${secret:REST_ENV_DEV_TOKEN}', secret: true }],
        }
      },
    } as unknown as EnvironmentService
    const ctx = {
      cwd: '/workspace',
      stateDir: '/state',
      z,
      defineTool: defineAgentTool,
      helpers: { errorResult: (message: string) => ({ content: message, isError: true }) },
    } as unknown as MiniAppContext
    const tool = createManageEnvironmentTool({ ctx, environments, userId: 'u' })

    const result = await tool.execute('call', {
      action: 'save',
      name: 'dev',
      variables: [{ name: 'token', value: 'literal-secret', secret: true }],
    })

    expect(result.isError).toBeUndefined()
    expect(received).toEqual([{ name: 'token', value: 'literal-secret', secret: true }])
  })
})

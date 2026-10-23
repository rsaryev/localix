import { expect, test } from 'bun:test'
import { defineAgentTool } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/mini-app-sdk/backend'
import { z } from 'zod'
import { createHttpRequestTool } from './http-request'
import { formatImportPreview } from './import-report'
import { expandCollection } from './resource-provider'
import { createMemoryCollection } from './collection/testing/memory'
import type { RequestAuth } from './request-spec'
import type { EnvironmentService } from './environments/service'

const auths: RequestAuth[] = [
  { type: 'none' },
  { type: 'basic', username: 'ada', password: 'fixture-password' },
  { type: 'bearer', token: '${secret:KEY}' },
  { type: 'apikey', key: 'X-Key', value: 'fixture-key' },
]

test.each(auths)('keeps redacted request roster text consistent for %j', async (auth) => {
  const store = createMemoryCollection([
    {
      name: 'Read',
      spec: {
        url: 'https://api.test?token=fixture-token',
        method: 'GET',
        headers: [],
        query: [],
        auth,
      },
    },
  ])
  const ctx = {
    z,
    defineTool: defineAgentTool,
    config: {},
    helpers: {
      configNumber: (_value: unknown, fallback: number) => fallback,
      configBoolean: () => false,
    },
    ui: { offer: (details: unknown) => details },
  } as unknown as PluginContext
  const tool = createHttpRequestTool({
    ctx,
    store,
    userId: 'u',
    environments: {} as EnvironmentService,
    resolveSecret: async () => null,
  })
  const suffix = auth.type === 'none' ? '' : ` [auth: ${auth.type}]`
  const expected = `Read: GET https://api.test?token=••••••${suffix}`
  const listed = await tool.execute('call', { action: 'list' })
  expect(listed.content).toBe(expected)
  const requests = await store.list()
  expect(expandCollection(requests)).toContain(`  ${expected}`)
  const preview = formatImportPreview(
    {
      importer: { name: 'Fixture' },
      notes: [],
      environments: [],
    },
    requests,
    'request',
  )
  expect(preview.content).toContain(`\n\n${expected}\n\n`)
  expect(requests[0]!.spec.auth).toBe(auth)
})

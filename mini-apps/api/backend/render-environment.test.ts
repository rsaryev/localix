import { describe, expect, test } from 'bun:test'
import type { EnvironmentService } from './environments/service'
import { renderEnvironmentForSend } from './render-environment'
import type { RequestSpec } from './request-spec'

const spec: RequestSpec = {
  url: '{{base_url}}/users?token={{token}}',
  method: 'GET',
  headers: [{ name: 'X-Session', value: '{{token}}' }],
  query: [],
  body: { mimeType: 'text/plain', text: '{{token}}' },
  auth: { type: 'none' },
}

describe('observable and wire environment renders', () => {
  test('a native-Vault value reaches the wire but not history/model/UI material', async () => {
    const service = {
      activeVars: async (_userId: string, options?: { resolveSecrets?: boolean }) =>
        new Map([
          ['base_url', 'https://api.dev'],
          ['token', options?.resolveSecrets ? 'literal-never-observed' : '${secret:SESSION_TOKEN}'],
        ]),
    } as unknown as EnvironmentService

    const rendered = await renderEnvironmentForSend(spec, service, 'u', 'users/list')
    expect(JSON.stringify(rendered.safe.spec)).not.toContain('literal-never-observed')
    expect(rendered.safe.spec.url).toContain('${secret:SESSION_TOKEN}')
    expect(rendered.safe.spec.headers[0]?.value).toBe('${secret:SESSION_TOKEN}')
    expect(rendered.wire.spec.url).toContain('literal-never-observed')
    expect(rendered.wire.spec.headers[0]?.value).toBe('literal-never-observed')
    expect(rendered.wire.spec.body?.text).toBe('literal-never-observed')
    expect(rendered.secretValues).toEqual(['literal-never-observed'])
  })
})

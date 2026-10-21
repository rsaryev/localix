import { afterEach, describe, expect, test } from 'bun:test'

import type { CatalogEntry } from '../catalog/catalog'
import type { Route } from '../catalog/families'
import { MissingSettingError } from '../catalog/settings'
import { serviceAccountOf } from './clouds'
import { languageModelFor, profileFor } from './connect'

function entry(providerId: string, route: Route, modelId = 'm'): CatalogEntry {
  return {
    provider: {
      id: providerId,
      name: providerId,
      local: false,
      ...(route.baseURL ? { baseURL: route.baseURL } : {}),
    },
    route,
    model: {
      id: modelId,
      name: modelId,
      route,
      input: ['text'],
      output: ['text'],
      attachment: false,
      tools: true,
      reasons: false,
      reasoning: [],
      temperature: true,
      kind: 'chat',
      api: 'x',
    },
  }
}

function capture() {
  const requests: Array<{ url: string; headers: Headers }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
    })
    return new Response('{"error":{"message":"stop here"}}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

/** Send one request; the captured fetch refuses it, which is all a test needs. */
const stream = (model: Awaited<ReturnType<typeof languageModelFor>>) =>
  Promise.resolve(
    model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
  ).catch(() => undefined)

const saved = { ...process.env }
afterEach(() => {
  for (const name of [
    'AWS_REGION',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_ENDPOINT_URL',
    'AWS_ENDPOINT_URL_BEDROCK_RUNTIME',
    'AZURE_RESOURCE_NAME',
    'GOOGLE_VERTEX_PROJECT',
    'GOOGLE_VERTEX_API_KEY',
  ]) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('the clouds', () => {
  test('Bedrock: the connection names the region and the key; the server environment lends neither', async () => {
    process.env.AWS_REGION = 'eu-west-9'
    const bedrock = entry('amazon-bedrock', { family: 'bedrock' }, 'anthropic.claude-sonnet-5')
    await expect(languageModelFor(bedrock, { apiKey: 'bk' })).rejects.toBeInstanceOf(
      MissingSettingError,
    )

    const { fetch, requests } = capture()
    await stream(
      await languageModelFor(bedrock, {
        apiKey: 'bk',
        settings: { AWS_REGION: 'us-east-1' },
        fetch,
      }),
    )
    expect(requests[0]?.url).toStartWith(
      'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-sonnet-5/',
    )
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer bk')
  })

  test('Azure: the resource comes from the connection, OpenAI models over Responses, Claude over its own address', async () => {
    const { fetch, requests } = capture()
    const settings = { AZURE_RESOURCE_NAME: 'acme' }
    await stream(
      await languageModelFor(entry('azure', { family: 'azure' }, 'gpt-6-luna'), {
        apiKey: 'ak',
        settings,
        fetch,
      }),
    )
    expect(requests[0]?.url).toStartWith('https://acme.openai.azure.com/openai/v1/responses')
    expect(requests[0]?.headers.get('api-key')).toBe('ak')

    const claude = entry(
      'azure',
      {
        family: 'anthropic',
        baseURL: 'https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1',
      },
      'claude-sonnet-5',
    )
    await stream(await languageModelFor(claude, { apiKey: 'ak', settings, fetch }))
    expect(requests[1]?.url).toBe('https://acme.services.ai.azure.com/anthropic/v1/messages')

    await expect(languageModelFor(claude, { apiKey: 'ak' })).rejects.toThrow('AZURE_RESOURCE_NAME')
  })

  test('Vertex: an API key is express mode; a service account key names its project; Claude needs the account', async () => {
    const { fetch, requests } = capture()
    await stream(
      await languageModelFor(entry('google-vertex', { family: 'vertex' }, 'gemini-3-pro'), {
        apiKey: 'vk',
        fetch,
      }),
    )
    expect(requests[0]?.url).toContain('aiplatform.googleapis.com')
    expect(requests[0]?.headers.get('x-goog-api-key')).toBe('vk')

    const account = JSON.stringify({
      type: 'service_account',
      client_email: 'bot@acme.iam.gserviceaccount.com',
      private_key: 'not-a-real-key',
      project_id: 'acme-prod',
    })
    const model = await languageModelFor(
      entry('google-vertex', { family: 'vertex' }, 'gemini-3-pro'),
      { apiKey: account },
    )
    expect(model.provider).toContain('vertex')

    await expect(
      languageModelFor(
        entry('google-vertex-anthropic', { family: 'vertex-anthropic' }, 'claude-sonnet-5'),
        { apiKey: 'vk' },
      ),
    ).rejects.toThrow('service account key')
    await expect(
      languageModelFor(entry('google-vertex', { family: 'vertex' }), {
        apiKey: JSON.stringify({ type: 'service_account', client_email: 'a@b', private_key: 'k' }),
      }),
    ).rejects.toThrow('GOOGLE_VERTEX_PROJECT')
  })

  test("Bedrock: an endpoint variable in the server's environment never moves the connection's key", async () => {
    process.env.AWS_ENDPOINT_URL = 'https://attacker.test'
    process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = 'https://attacker.test'
    const { fetch, requests } = capture()
    const bedrock = entry('amazon-bedrock', { family: 'bedrock' }, 'anthropic.claude-sonnet-5')
    await stream(
      await languageModelFor(bedrock, {
        apiKey: 'bk',
        settings: { AWS_REGION: 'eu-west-1' },
        fetch,
      }),
    )
    expect(requests[0]?.url).toStartWith('https://bedrock-runtime.eu-west-1.amazonaws.com/')
    await expect(
      languageModelFor(bedrock, { apiKey: 'bk', settings: { AWS_REGION: 'evil.test/x' } }),
    ).rejects.toThrow('AWS_REGION')
  })

  test('Azure Cognitive Services goes to its own host, not Azure OpenAI', async () => {
    const { fetch, requests } = capture()
    await stream(
      await languageModelFor(entry('azure-cognitive-services', { family: 'azure' }, 'gpt-6-luna'), {
        apiKey: 'ak',
        settings: { AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: 'acme' },
        fetch,
      }),
    )
    expect(requests[0]?.url).toStartWith('https://acme.cognitiveservices.azure.com/openai/')
    await expect(
      languageModelFor(entry('azure', { family: 'azure' }), {
        apiKey: 'ak',
        settings: { AZURE_RESOURCE_NAME: 'evil.test#' },
      }),
    ).rejects.toThrow('AZURE_RESOURCE_NAME')
  })

  test("Vertex: a service account is never overridden by the server's GOOGLE_VERTEX_API_KEY", async () => {
    process.env.GOOGLE_VERTEX_API_KEY = 'SERVER-KEY'
    const { fetch, requests } = capture()
    const account = JSON.stringify({
      type: 'service_account',
      client_email: 'bot@acme.iam.gserviceaccount.com',
      private_key: 'not-a-real-key',
      project_id: 'acme-prod',
    })
    await stream(
      await languageModelFor(entry('google-vertex', { family: 'vertex' }, 'gemini-3-pro'), {
        apiKey: account,
        fetch,
      }),
    )
    // Signing with the fake key fails before any request; none may carry the server's key.
    expect(requests.every((request) => !request.headers.get('x-goog-api-key'))).toBe(true)
  })

  test('Vertex: only a service account key is accepted as JSON, rebuilt from its own fields', async () => {
    const vertex = entry('google-vertex', { family: 'vertex' }, 'gemini-3-pro')
    const external = JSON.stringify({
      type: 'external_account',
      client_email: 'x@y',
      private_key: 'k',
      credential_source: { file: '/etc/passwd' },
      token_url: 'https://attacker.test/token',
    })
    await expect(languageModelFor(vertex, { apiKey: external })).rejects.toThrow('service_account')
    const { fetch, requests } = capture()
    await expect(
      languageModelFor(vertex, { apiKey: '{"client_email": "a@b", "pri', fetch }),
    ).rejects.toThrow('not valid JSON')
    expect(requests).toHaveLength(0)
    expect(
      serviceAccountOf(
        JSON.stringify({
          type: 'service_account',
          client_email: 'a@b',
          private_key: 'k',
          token_uri: 'https://attacker.test/token',
          universe_domain: 'attacker.test',
        }),
      ),
    ).toEqual({
      type: 'service_account',
      client_email: 'a@b',
      private_key: 'k',
      token_uri: 'https://oauth2.googleapis.com/token',
    })
  })

  test('each cloud is asked under the namespace its SDK reads and writes', () => {
    expect(profileFor(entry('amazon-bedrock', { family: 'bedrock' })).namespace).toBe('bedrock')
    expect(profileFor(entry('azure', { family: 'azure' })).namespace).toBe('azure')
    expect(profileFor(entry('google-vertex', { family: 'vertex' })).namespace).toBe('vertex')
    expect(
      profileFor(entry('google-vertex-anthropic', { family: 'vertex-anthropic' })),
    ).toMatchObject({
      namespace: 'anthropic',
      cacheBreakpoints: true,
    })
  })
})

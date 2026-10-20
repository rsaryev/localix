import { afterEach, describe, expect, test } from 'bun:test'

import type { CatalogEntry } from '../catalog/catalog'
import type { Route } from '../catalog/families'
import { MissingSettingError } from '../catalog/settings'
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
    'AZURE_RESOURCE_NAME',
    'GOOGLE_VERTEX_PROJECT',
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
        apiKey: JSON.stringify({ client_email: 'a@b', private_key: 'k' }),
      }),
    ).rejects.toThrow('GOOGLE_VERTEX_PROJECT')
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

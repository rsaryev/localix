import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  fauxAssistantMessage,
  fauxProvider,
  normalizeContext,
  type AssistantMessageEventStream,
  type StreamOptions,
} from '@earendil-works/pi-ai'
import {
  OPENROUTER_ATTRIBUTION_HEADERS,
  openRouterRequestHeaders,
  piProviders,
  withOpenRouterMetadata,
} from './providers'

describe('OpenRouter provider metadata', () => {
  test('adds current app attribution and a bounded session id without leaking the API key', async () => {
    const faux = fauxProvider({ provider: 'openrouter' })
    let requestOptions: StreamOptions | undefined
    faux.setResponses([
      (_context, options) => {
        requestOptions = options
        return fauxAssistantMessage('ok')
      },
    ])
    let delegatedStream: AssistantMessageEventStream | undefined
    const provider = withOpenRouterMetadata({
      ...faux.provider,
      headers: { 'X-Provider-Default': 'preserved' },
      streamSimple(model, context, options) {
        delegatedStream = faux.provider.streamSimple(model, context, options)
        return delegatedStream
      },
    })

    const stream = provider.streamSimple(
      faux.getModel(),
      // A provider takes a TRANSCRIPT now, not a loose context (pi moved the prompt and the
      // tool roster into the message list); `normalizeContext` is how one is built.
      normalizeContext({ messages: [] }),
      { apiKey: 'sk-or-secret', sessionId: `  ${'s'.repeat(300)}  ` },
    )
    expect(stream).toBe(delegatedStream!)
    await stream.result()

    expect(requestOptions?.headers).toMatchObject(OPENROUTER_ATTRIBUTION_HEADERS)
    expect(requestOptions?.headers?.['X-Provider-Default']).toBe('preserved')
    expect(requestOptions?.headers?.['x-session-id']).toHaveLength(256)
    expect(requestOptions?.headers?.Authorization).toBeUndefined()
  })

  test('merges header overrides case-insensitively and keeps caller values last', () => {
    const headers = openRouterRequestHeaders({
      'x-openrouter-title': 'Custom title',
      'X-Custom': 'value',
    })

    expect(headers['X-OpenRouter-Title']).toBeUndefined()
    expect(headers['x-openrouter-title']).toBe('Custom title')
    expect(headers['HTTP-Referer']).toBe('https://localix.ai')
    expect(headers['X-OpenRouter-Categories']).toBe('personal-agent,programming-app')
    expect(headers['X-Custom']).toBe('value')
  })

  test('uses the same attributed OpenRouter provider in the shared pi registry', () => {
    const provider = piProviders().find((entry) => entry.id === 'openrouter')
    expect(provider?.headers).toMatchObject(OPENROUTER_ATTRIBUTION_HEADERS)
    expect(provider?.auth.oauth?.loginLabel).toBe('Sign in with OpenRouter')
  })

  test('reuses immutable provider definitions but isolates refreshable catalog state', () => {
    const first = piProviders()
    const second = piProviders()

    expect(second.find((provider) => provider.id === 'openai')).toBe(
      first.find((provider) => provider.id === 'openai'),
    )
    expect(Object.isFrozen(first.find((provider) => provider.id === 'openai'))).toBe(true)
    expect(second.find((provider) => provider.id === 'openrouter')).toBe(
      first.find((provider) => provider.id === 'openrouter'),
    )
    expect(second.find((provider) => provider.id === 'radius')).not.toBe(
      first.find((provider) => provider.id === 'radius'),
    )
  })

  test('embeds OAuth implementations in a standalone Bun bundle', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'localix-pi-oauth-bundle-'))
    try {
      const entry = join(tempDir, 'entry.ts')
      await Bun.write(
        entry,
        [
          `import { piProviders } from ${JSON.stringify(join(import.meta.dir, 'providers.ts'))}`,
          'export async function deriveOpenRouterAuth() {',
          "  const oauth = piProviders().find((provider) => provider.id === 'openrouter')?.auth.oauth",
          "  if (!oauth) throw new Error('OpenRouter OAuth is unavailable')",
          "  return oauth.toAuth({ type: 'oauth', access: 'oauth-key', refresh: '', expires: Number.MAX_SAFE_INTEGER })",
          '}',
        ].join('\n'),
      )
      const result = await Bun.build({
        entrypoints: [entry],
        outdir: tempDir,
        target: 'bun',
        format: 'esm',
      })
      expect(result.success).toBe(true)
      if (!result.success) throw new Error(result.logs.map(String).join('\n'))
      const output = result.outputs[0]?.path
      if (!output) throw new Error('Bun produced no OAuth regression bundle')

      const bundled = (await import(`${pathToFileURL(output).href}?test=${Date.now()}`)) as {
        deriveOpenRouterAuth(): Promise<{ apiKey?: string }>
      }
      expect(bundled.deriveOpenRouterAuth()).resolves.toEqual({ apiKey: 'oauth-key' })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

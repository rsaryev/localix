import { describe, expect, test } from 'bun:test'

import type { CatalogEntry } from '../catalog/catalog'
import type { Route } from '../catalog/families'
import { addressOf, decisionModelFor, profileFor } from './connect'

function entry(
  providerId: string,
  route: Route,
  model: Partial<CatalogEntry['model']> = {},
  providerBase?: string,
): CatalogEntry {
  return {
    provider: {
      id: providerId,
      name: providerId,
      local: false,
      ...(providerBase ? { baseURL: providerBase } : {}),
    },
    route,
    model: {
      id: 'm',
      name: 'M',
      route,
      input: ['text'],
      output: ['text'],
      attachment: false,
      tools: true,
      reasons: true,
      reasoning: ['off', 'low', 'high', 'max'],
      temperature: true,
      kind: 'chat',
      api: 'x',
      ...model,
    },
  }
}

const context = (reasoningEffort?: 'off' | 'low' | 'max') => ({
  sessionId: 's',
  reasoningEffort,
  idleMs: undefined,
})

describe('reaching a model', () => {
  test("an access that names its host moves the provider, and a model address extending the provider's moves with it", () => {
    const base = 'https://api.githubcopilot.com'
    const claude = entry('github-copilot', { family: 'anthropic', baseURL: `${base}/v1` }, {}, base)
    const gpt = entry('github-copilot', { family: 'openai', baseURL: base }, {}, base)
    const account = { baseURL: 'https://api.business.githubcopilot.com/' }
    expect(addressOf(claude, account)).toBe('https://api.business.githubcopilot.com/v1')
    expect(addressOf(gpt, account)).toBe('https://api.business.githubcopilot.com/')
    expect(addressOf(claude, {})).toBe(`${base}/v1`)
  })

  test('OpenRouter is told the reasoning level in its own terms, since its SDK reads no standard one', () => {
    const profile = profileFor(
      entry('openrouter', { family: 'openrouter', baseURL: 'https://openrouter.ai/api/v1' }),
    )
    expect(profile.requestOptions?.(context('max'))).toEqual({
      usage: { include: true },
      reasoning: { effort: 'xhigh' },
    })
    expect(profile.requestOptions?.(context('off'))).toEqual({
      usage: { include: true },
      reasoning: { effort: 'none' },
    })
    expect(profile.requestOptions?.(context())).toEqual({ usage: { include: true } })
  })

  test('a model that takes no temperature is never sent one; the ChatGPT backend takes no output limit', () => {
    expect(
      profileFor(entry('openai', { family: 'openai' }, { temperature: false })).temperature,
    ).toBe(false)
    expect(profileFor(entry('openai-codex', { family: 'openai' })).refusesOutputLimit).toBe(true)
    expect(profileFor(entry('openai', { family: 'openai' })).refusesOutputLimit).toBeUndefined()
  })

  test('every decision model answers through doDecide, whatever name its SDK gives the call', async () => {
    const decisions = { kind: 'decision' as const, api: 'decisions', reasons: false, reasoning: [] }
    const openrouter = await decisionModelFor(
      entry(
        'openrouter',
        { family: 'openrouter', baseURL: 'https://openrouter.ai/api/v1' },
        decisions,
      ),
      { apiKey: 'k' },
    )
    const gateway = await decisionModelFor(entry('vercel', { family: 'gateway' }, decisions), {
      apiKey: 'k',
    })
    const openai = await decisionModelFor(entry('openai', { family: 'openai' }, decisions), {
      apiKey: 'k',
    })
    for (const model of [openrouter, gateway, openai])
      expect(typeof model.doDecide).toBe('function')
    expect(openrouter.supportedQuestionTypes).toContain('choice')
  })
})

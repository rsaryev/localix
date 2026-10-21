import { describe, expect, test } from 'bun:test'
import type { Message } from '@localixai/agent'

import type { CatalogEntry } from '../catalog/catalog'
import type { Route } from '../catalog/families'
import { assertServable, PreflightRejection } from '../model-access'
import { wireTraits } from './traits'

function entry(providerId: string, route: Route, model: Partial<CatalogEntry['model']> = {}) {
  return {
    provider: { id: providerId, name: providerId, local: false },
    route,
    model: {
      id: 'm',
      name: 'M',
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
      ...model,
    },
  } as CatalogEntry
}

describe('what a request knows about its model', () => {
  test('images, the compatible wire and strict tool-call ids', () => {
    expect(wireTraits(entry('openai', { family: 'openai' }, { input: ['text', 'image'] }))).toEqual(
      {
        images: true,
      },
    )
    expect(wireTraits(entry('deepseek', { family: 'openai-compatible' }))).toEqual({
      images: false,
      compatible: true,
    })
    expect(wireTraits(entry('mistral', { family: 'openai-compatible' })).toolCallIds).toBe(
      'mistral',
    )
    expect(wireTraits(entry('anthropic', { family: 'anthropic' })).toolCallIds).toBe('anthropic')
  })

  test('Claude on Bedrock and behind the gateway reads explicit cache breakpoints', () => {
    expect(
      wireTraits(entry('amazon-bedrock', { family: 'bedrock' }, { id: 'us.anthropic.claude-x' })),
    ).toMatchObject({ cacheBreakpoints: true, cachePoints: 'bedrock', toolCallIds: 'anthropic' })
    expect(
      wireTraits(entry('vercel', { family: 'gateway' }, { id: 'anthropic/claude-x' })),
    ).toMatchObject({ cacheBreakpoints: true, cachePoints: 'anthropic' })
    expect(
      wireTraits(entry('amazon-bedrock', { family: 'bedrock' }, { id: 'amazon.nova' })),
    ).not.toHaveProperty('cacheBreakpoints')
  })
})

describe('the preflight', () => {
  const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA' }
  const text = entry('deepseek', { family: 'openai-compatible' })
  const ref = { providerId: 'deepseek', modelId: 'm' }

  test('refuses an image the person sends now to a model that cannot read it', () => {
    const messages: Message[] = [{ role: 'user', content: [image], timestamp: 0 }]
    expect(() => assertServable(text, ref, messages)).toThrow(PreflightRejection)
  })

  test('lets a conversation with an older image continue on a text-only model', () => {
    const messages: Message[] = [
      { role: 'user', content: [image], timestamp: 0 },
      { role: 'assistant', model: 'm', timestamp: 0, content: [{ type: 'text', text: 'seen' }] },
      { role: 'user', content: 'and now?', timestamp: 0 },
    ]
    expect(() => assertServable(text, ref, messages)).not.toThrow()
  })
})

import { describe, expect, test } from 'bun:test'
import type { CatalogModel } from '@/shared/hooks/useModelsCatalog'
import { recommendChatModel, recommendationReason } from './recommendedModel'

function model(partial: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: partial.id,
    providerId: 'acme',
    providerName: 'Acme',
    supportsTools: true,
    supportsReasoning: false,
    supportsAttachment: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    ...partial,
  }
}

describe('recommendChatModel', () => {
  test('returns null without a provider or with an empty catalog', () => {
    expect(recommendChatModel([model({ id: 'a' })], null)).toBeNull()
    expect(recommendChatModel([], 'acme')).toBeNull()
  })

  test('never crosses provider boundaries', () => {
    const picked = recommendChatModel(
      [model({ id: 'other', providerId: 'globex' }), model({ id: 'mine' })],
      'acme',
    )
    expect(picked?.id).toBe('mine')
  })

  /** Tool calling is what makes a model usable as an agent at all. */
  test('prefers a tool-calling model over a better-specced one without tools', () => {
    const picked = recommendChatModel(
      [
        model({
          id: 'no-tools',
          supportsTools: false,
          supportsReasoning: true,
          contextLength: 1e6,
        }),
        model({ id: 'tools' }),
      ],
      'acme',
    )
    expect(picked?.id).toBe('tools')
  })

  test('falls back to plain chat models when the provider has no tool support', () => {
    const picked = recommendChatModel(
      [model({ id: 'plain', supportsTools: false, contextLength: 32_000 })],
      'acme',
    )
    expect(picked?.id).toBe('plain')
  })

  test('excludes non-chat models by id and by output modality', () => {
    const picked = recommendChatModel(
      [
        model({ id: 'text-embedding-3-large', contextLength: 1e6 }),
        model({ id: 'whisper-1' }),
        model({ id: 'image-gen', outputModalities: ['image'], contextLength: 1e6 }),
        model({ id: 'chat' }),
      ],
      'acme',
    )
    expect(picked?.id).toBe('chat')
  })

  test('prefers the newer release among otherwise equal models', () => {
    const picked = recommendChatModel(
      [
        model({ id: 'old', releaseDate: '2023-01-01' }),
        model({ id: 'new', releaseDate: new Date().toISOString().slice(0, 10) }),
      ],
      'acme',
    )
    expect(picked?.id).toBe('new')
  })

  test('discounts a wildly expensive model against a comparable cheaper one', () => {
    const picked = recommendChatModel(
      [
        model({ id: 'premium', cost: { input: 75, output: 150 } }),
        model({ id: 'workhorse', cost: { input: 3, output: 15 } }),
      ],
      'acme',
    )
    expect(picked?.id).toBe('workhorse')
  })

  /** The cost discount must not turn "cheapest" into "the default we suggest". */
  test('prefers the standard model over its mini sibling', () => {
    const picked = recommendChatModel(
      [
        model({ id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', cost: { input: 0.4, output: 1.6 } }),
        model({ id: 'gpt-5.4', name: 'GPT-5.4', cost: { input: 2, output: 8 } }),
      ],
      'acme',
    )
    expect(picked?.id).toBe('gpt-5.4')
  })

  /** An unstable suggestion chip reads as a bug, so equal scores must not flap. */
  test('breaks ties deterministically regardless of catalog order', () => {
    const a = model({ id: 'aaa' })
    const b = model({ id: 'bbb' })
    expect(recommendChatModel([a, b], 'acme')?.id).toBe('aaa')
    expect(recommendChatModel([b, a], 'acme')?.id).toBe('aaa')
  })
})

describe('recommendationReason', () => {
  test('names the capabilities the pick actually has', () => {
    expect(recommendationReason(model({ id: 'x', supportsReasoning: true }))).toBe(
      'Supports tool calling · reasoning',
    )
  })

  test('degrades gracefully for a bare model', () => {
    expect(recommendationReason(model({ id: 'x', supportsTools: false }))).toBe(
      'Most capable model on this connection',
    )
  })
})

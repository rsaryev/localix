import { describe, expect, test } from 'bun:test'
import type { CatalogModel } from '@localixai/agent/catalog'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelDetailPanel } from './ModelDetailPanel'

const model: CatalogModel = {
  id: 'gpt-5.6',
  name: 'GPT-5.6 Sol',
  providerId: 'openai-codex',
  providerName: 'OpenAI Codex',
  supportsTools: true,
  supportsReasoning: true,
  supportsAttachment: true,
  inputModalities: ['text', 'image'],
  outputModalities: ['text'],
  cost: {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
}

describe('ModelDetailPanel presentation', () => {
  test('reads as overview, pricing and quiet identifiers, with no rule between groups', () => {
    const html = renderToStaticMarkup(<ModelDetailPanel model={model} />)

    expect(html).toContain('Overview')
    expect(html).toContain('Text, Image')
    expect(html).toContain('$1.25')
    expect(html.indexOf('Pricing')).toBeLessThan(html.indexOf('Model ID'))
    expect(html).not.toContain('divide-y')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-surface-raised')
  })

  test('lists only the features a model has, and never the one every model has', () => {
    const html = renderToStaticMarkup(
      <ModelDetailPanel model={{ ...model, supportsTools: false }} />,
    )
    const features = html.slice(html.indexOf('data-slot="model-features"'))
    expect(features).toContain('Reasoning')
    expect(features).toContain('Vision')
    expect(features).toContain('Caching')
    expect(features).not.toContain('Tools')
    expect(html).not.toContain('Streaming')
  })

  test('names the long-context rate in words and puts settings first', () => {
    const html = renderToStaticMarkup(
      <ModelDetailPanel
        model={{
          ...model,
          cost: { ...model.cost!, tiers: [{ inputTokensAbove: 272_000, input: 2.5, output: 20 }] },
        }}
        settings={<span>reasoning-row</span>}
      />,
    )
    expect(html).toContain('Above 272k')
    expect(html).toContain('$2.50 in · $20.00 out')
    expect(html.indexOf('reasoning-row')).toBeLessThan(html.indexOf('Overview'))
  })
})

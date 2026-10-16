import { describe, expect, test } from 'bun:test'
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai'
import { GeneratedCatalogRefresher } from '@earendil-works/pi-ai/generated-catalog'

import { clampModelReasoning, REASONING_EFFORT_OPTIONS } from '@localixai/agent'
import { sortCatalogModelsNewestFirst } from '@localixai/agent/catalog'
import type { EngineCatalog } from '@localixai/agent/runtime'

import { fixtureFetch } from './__fixtures__/generated-catalog-documents'
import { createPiCatalog, listPiCatalog } from './catalog'
import { resolveReasoningEffort } from './preflight'
import { createPiModelsCollection, createPiProviders } from './providers'

type PiModel = Model<Api>

const LEVELS = REASONING_EFFORT_OPTIONS.map((option) => option.value)
const piModels = createPiModelsCollection().getModels()
const piModel = (provider: string, id: string) => {
  const model = piModels.find((entry) => entry.provider === provider && entry.id === id)
  if (!model) throw new Error(`pi catalog has no ${provider}/${id}`)
  return model
}

interface ConformanceSubject {
  /** pi's own model objects. */
  models: () => readonly PiModel[]
  /** The catalog projected from those models. */
  catalog: () => Promise<EngineCatalog>
}

/**
 * The catalog's level list, the picker/server clamp and the request are all pi's answer. These
 * walk a whole catalog, so a model whose data disagrees fails here by name — for the generated
 * catalog and for one refreshed through `Models.refresh()` alike.
 */
function conformance(label: string, subject: ConformanceSubject) {
  describe(`catalog reasoning is pi’s answer (${label})`, () => {
    test('every model lists exactly pi’s supported levels', async () => {
      const catalog = await subject.catalog()
      const byId = new Map(catalog.models.map((model) => [model.id, model]))
      let checked = 0
      for (const model of subject.models()) {
        const entry = byId.get(`${model.provider}/${model.id}`)
        if (!entry) continue
        expect({ id: entry.id, levels: entry.reasoningEfforts }).toEqual({
          id: entry.id,
          levels: getSupportedThinkingLevels(model),
        })
        checked += 1
      }
      expect(checked).toBeGreaterThan(0)
    })

    test('the shared clamp gives pi’s clampThinkingLevel answer for every model and level', async () => {
      const catalog = await subject.catalog()
      const byId = new Map(catalog.models.map((model) => [model.id, model]))
      let checked = 0
      for (const model of subject.models()) {
        const entry = byId.get(`${model.provider}/${model.id}`)
        if (!entry) continue
        for (const level of LEVELS) {
          expect({
            id: entry.id,
            level,
            runs: clampModelReasoning(level, entry.reasoningEfforts),
          }).toEqual({
            id: entry.id,
            level,
            runs: clampThinkingLevel(model, level as ModelThinkingLevel),
          })
          checked += 1
        }
      }
      expect(checked).toBeGreaterThan(1000)
    })

    test('the catalog lists off exactly where the request sends no reasoning', async () => {
      const catalog = await subject.catalog()
      const byId = new Map(catalog.models.map((model) => [model.id, model]))
      for (const model of subject.models()) {
        if (!model.reasoning) continue
        const entry = byId.get(`${model.provider}/${model.id}`)
        if (!entry) continue
        expect({ id: entry.id, off: entry.reasoningEfforts?.includes('off') }).toEqual({
          id: entry.id,
          off: resolveReasoningEffort(model, 'off').effort === undefined,
        })
      }
    })
  })
}

conformance('generated', { models: () => piModels, catalog: listPiCatalog })

// A catalog refreshed from fixture documents: the models pi's generator would produce from them,
// published over the generated baseline.
const refreshedProviders = createPiProviders(
  new GeneratedCatalogRefresher({ fetch: fixtureFetch().fetch }),
)
const refreshedCatalog = createPiCatalog({ providers: refreshedProviders })
const refreshed = refreshedCatalog.refresh({ allowNetwork: true })
conformance('refreshed', {
  models: () => refreshedProviders.flatMap((provider) => provider.getModels()),
  catalog: async () => {
    const result = await refreshed
    expect(result.errors).toEqual([])
    const catalog = await refreshedCatalog.list()
    // The fixture's models are there, so the walk covers refreshed data, not just the baseline.
    for (const id of ['openai/gpt-fixture-1', 'openrouter/acme/always-thinks', 'zai/glm-fixture']) {
      expect(catalog.models.map((model) => model.id)).toContain(id)
    }
    return catalog
  },
})

describe('pi’s data: off', () => {
  test('Off on a model that cannot switch thinking off asks for its lowest level, not the default', () => {
    // Sending no level would leave the provider default (`high`) in charge.
    for (const [provider, id] of [
      ['anthropic', 'claude-opus-5-5'],
      ['anthropic', 'claude-haiku-5-5'],
      ['openai', 'gpt-6.1-sol'],
      ['openai', 'gpt-6-astra'],
    ] as const) {
      expect(resolveReasoningEffort(piModel(provider, id), 'off')).toEqual({
        effort: 'low',
        clampedFrom: 'off',
      })
    }
  })

  test('Off stays off where the model can disable thinking', () => {
    expect(resolveReasoningEffort(piModel('openai', 'gpt-6-sol'), 'off')).toEqual({
      effort: undefined,
    })
  })

  test('formats with an explicit thinking toggle never carry off: null', () => {
    // pi sends `thinking: {type: "disabled"}` / `enable_thinking: false` / `reasoning: {enabled:
    // false}` whenever no level is sent; the generator drops the effort list's `off: null` there.
    const toggled = new Set(['zai', 'qwen', 'qwen-chat-template', 'together'])
    const offenders = piModels
      .filter(
        (model) =>
          model.api === 'openai-completions' &&
          model.reasoning &&
          toggled.has(
            (model.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat ?? '',
          ) &&
          model.thinkingLevelMap?.off === null,
      )
      .map((model) => `${model.provider}/${model.id}`)
    expect(offenders).toEqual([])
    const glm = piModels.find(
      (model) => model.provider === 'qwen-token-plan' && model.id === 'glm-5.2',
    )
    if (glm) expect(resolveReasoningEffort(glm, 'off')).toEqual({ effort: undefined })
  })
})

describe('pi’s data: release dates', () => {
  test('direct providers carry a release date on every model pi generated from models.dev', async () => {
    const catalog = await listPiCatalog()
    for (const provider of ['anthropic', 'openai-codex', 'google', 'deepseek', 'zai', 'xai']) {
      const models = catalog.models.filter((model) => model.providerId === provider)
      expect(models.length).toBeGreaterThan(0)
      expect(models.filter((model) => !model.releaseDate).map((model) => model.id)).toEqual([])
    }
    for (const model of catalog.models) {
      if (model.releaseDate) expect(model.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test('the catalog sorts each provider newest-first with undated models last', async () => {
    const sorted = sortCatalogModelsNewestFirst((await listPiCatalog()).models)
    const anthropic = sorted.filter((model) => model.providerId === 'anthropic')
    const dates = anthropic.map((model) => model.releaseDate!)
    expect(dates).toEqual([...dates].sort().reverse())
    const openai = sorted.filter((model) => model.providerId === 'openai')
    const firstUndated = openai.findIndex((model) => !model.releaseDate)
    if (firstUndated >= 0)
      expect(openai.slice(firstUndated).every((m) => !m.releaseDate)).toBe(true)
  })
})

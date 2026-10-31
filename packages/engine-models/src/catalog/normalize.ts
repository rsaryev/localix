/**
 * MODELS.DEV, NORMALIZED: the providers and models this engine can serve, each with the route its
 * requests take and the facts a picker, a preflight and a cost ledger read — in a compact document
 * of our own, versioned, so it can be stored and read back without models.dev's whole payload.
 *
 * Decided here, once per document rather than per request:
 * - the route: a model's own `provider.npm/api/shape` over its provider's;
 * - the kind: chat, or decision where the provider SDK has a decision model; other kinds go;
 * - the reasoning levels, `off` only where models.dev says reasoning can be switched off;
 * - the context the host may fill, capped at the first long-context price tier.
 */
import type { CatalogModel, ModelCost } from '@localixai/agent/catalog'
import type { Model } from '@opencode-ai/models'

import { modelAddressAllowed, providerAddress } from './addresses'
import { apiOf, DECISION_FAMILIES, routeOf, type Route } from './families'
import { contextWindowOf, costOf, reasoningLevels } from './model-facts'
import { settingsOf, type ProviderSetting } from './settings'

/** Bumped whenever normalization changes what it keeps, so a stored copy is normalized again. */
export const DOCUMENT_SCHEMA = 5

export interface ServedModel {
  id: string
  name: string
  route: Route
  input: string[]
  output: string[]
  attachment: boolean
  tools: boolean
  /** It reasons — on its own terms when `reasoning` is empty. */
  reasons: boolean
  /** Levels a caller may ask for, weakest first; `off` only where reasoning can be switched off. */
  reasoning: string[]
  /** Accepts a sampling temperature. */
  temperature: boolean
  /** Where reasoning is replayed on the OpenAI-compatible wire, when the provider wants it back. */
  interleaved?: 'reasoning_content' | 'reasoning_details'
  contextWindow?: number
  maxOutputTokens?: number
  cost?: ModelCost
  releaseDate?: string
  family?: string
  status?: 'alpha' | 'beta' | 'deprecated'
}

export interface ServedProvider {
  id: string
  name: string
  /** API-key variables; none means it is reached by signing in. */
  env: string[]
  /** What a connection names besides its key (a region, a resource, a project). */
  settings: ProviderSetting[]
  doc?: string
  /** The provider's own route, shown on its card; a model may take another. */
  route: Route
  chat: Record<string, ServedModel>
  decision: Record<string, ServedModel>
}

export type CatalogDocument = Record<string, ServedProvider>

export const CODEX_PROVIDER_ID = 'openai-codex'
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
/** What a ChatGPT plan reaches through Codex; the rest of OpenAI's list needs an API account. */
const CODEX_MODELS = [
  'gpt-5.3-codex-spark',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-6.1-sol',
]
const CODEX_CONTEXT = 272_000
/** OpenAI's Decisions API takes its chat model's id; models.dev lists only the chat model. */
const OPENAI_DECISION_MODELS = ['gpt-6-luna']

/** Ids the engine serves itself, and keys no record may be stored under. */
const RESERVED = new Set(['local', 'openai-codex', '__proto__', 'constructor', 'prototype'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function servedModel(model: Model, route: Route): ServedModel {
  const cost = costOf(model.cost)
  const input = strings(model.modalities?.input)
  const interleaved = isRecord(model.interleaved) ? model.interleaved.field : undefined
  const contextWindow = contextWindowOf(model.limit, cost)
  return {
    id: model.id,
    name: typeof model.name === 'string' && model.name ? model.name : model.id,
    route,
    input: input.length > 0 ? input : ['text'],
    output: strings(model.modalities?.output),
    // models.dev declares these; a record that leaves one out reads as its usual value.
    attachment: Boolean(model.attachment) || input.includes('image'),
    tools: (model.tool_call as boolean | undefined) ?? true,
    reasons: Boolean(model.reasoning),
    reasoning: reasoningLevels(model, route),
    temperature: (model.temperature as boolean | undefined) ?? true,
    ...(interleaved === 'reasoning_content' || interleaved === 'reasoning_details'
      ? { interleaved }
      : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(model.limit?.output ? { maxOutputTokens: model.limit.output } : {}),
    ...(cost ? { cost } : {}),
    ...(model.release_date ? { releaseDate: model.release_date } : {}),
    ...(model.family ? { family: model.family } : {}),
    ...(model.status ? { status: model.status } : {}),
  }
}

/** A decision model answers typed questions and writes nothing: no tools, no reasoning, no output price. */
function asDecision(model: ServedModel): ServedModel {
  const { interleaved: _, ...rest } = model
  return {
    ...rest,
    output: ['decisions'],
    tools: false,
    reasons: false,
    reasoning: [],
    ...(model.cost ? { cost: { ...model.cost, output: 0 } } : {}),
  }
}

function codexProvider(openai: ServedProvider | undefined): ServedProvider | undefined {
  if (!openai) return undefined
  const route: Route = { family: 'openai', baseURL: CODEX_BASE_URL }
  const chat: Record<string, ServedModel> = {}
  for (const id of CODEX_MODELS) {
    const model = openai.chat[id]
    // The ChatGPT backend takes no temperature, and its window is the plan's, not the API's.
    if (model)
      chat[id] = {
        ...model,
        route,
        temperature: false,
        contextWindow: Math.min(model.contextWindow ?? CODEX_CONTEXT, CODEX_CONTEXT),
      }
  }
  return {
    id: CODEX_PROVIDER_ID,
    name: 'ChatGPT Plus/Pro (Codex)',
    env: [],
    settings: [],
    route,
    chat,
    decision: {},
  }
}

/**
 * The document for a models.dev provider map. Defensive per record: a provider or model that does
 * not have the shape it should is left out, never the whole document.
 */
export function normalize(providers: unknown): CatalogDocument {
  const document: CatalogDocument = {}
  if (!isRecord(providers)) return document
  for (const [id, provider] of Object.entries(providers)) {
    if (
      RESERVED.has(id) ||
      !isRecord(provider) ||
      typeof provider.npm !== 'string' ||
      typeof provider.name !== 'string' ||
      !isRecord(provider.models)
    )
      continue
    const npm = provider.npm
    const api = providerAddress(id, typeof provider.api === 'string' ? provider.api : undefined)
    if (api === null) continue
    const models = Object.entries(provider.models).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        !RESERVED.has(entry[0]) && isRecord(entry[1]),
    )
    const ownApi = (value: Record<string, unknown>) =>
      isRecord(value.provider) && typeof value.provider.api === 'string'
        ? value.provider.api
        : undefined
    const settings = settingsOf(strings(provider.env), [
      api,
      ...models.map(([, value]) => ownApi(value)),
    ])
    const settable = settings.map((setting) => setting.name)
    const route = routeOf(npm, api, undefined, settable)
    const chat: Record<string, ServedModel> = {}
    const decision: Record<string, ServedModel> = {}
    for (const [modelId, value] of models) {
      const model = { ...(value as unknown as Model), id: modelId }
      const own = isRecord(model.provider)
        ? (model.provider as NonNullable<Model['provider']>)
        : undefined
      // A model's own address must not carry the provider's key anywhere else.
      if (own?.api && own.api !== api && !modelAddressAllowed(id, api, own.api)) continue
      const kind = model.type ?? 'chat'
      const ownRoute =
        own?.npm || own?.api || own?.shape
          ? routeOf(own.npm ?? npm, own.api ?? api, own.shape, settable)
          : route
      // A decision model naming only its own SDK package (OpenRouter's Jev as
      // `@ai-sdk/typesafe-ai`) is still served at its provider's address, through the
      // provider's decision API: the package is the vendor's client, not another route.
      const modelRoute =
        kind === 'decision' &&
        !own?.api &&
        route &&
        DECISION_FAMILIES.has(route.family) &&
        !(ownRoute && DECISION_FAMILIES.has(ownRoute.family))
          ? route
          : ownRoute
      if (!modelRoute) continue
      if (kind === 'decision') {
        if (DECISION_FAMILIES.has(modelRoute.family))
          decision[modelId] = asDecision(servedModel(model, modelRoute))
      } else if (kind === 'chat') {
        const served = servedModel(model, modelRoute)
        if (served.output.length === 0 || served.output.includes('text'))
          chat[modelId] = { ...served, output: served.output.length > 0 ? served.output : ['text'] }
      }
    }
    if (id === 'openai')
      for (const modelId of OPENAI_DECISION_MODELS)
        if (chat[modelId]) decision[modelId] = asDecision(chat[modelId])
    if (!route && Object.keys(chat).length + Object.keys(decision).length === 0) continue
    document[id] = {
      id,
      name: provider.name,
      env: strings(provider.env),
      settings,
      ...(typeof provider.doc === 'string' ? { doc: provider.doc } : {}),
      // A provider served only through its models' own routes shows the first of them.
      route: route ?? (Object.values(chat)[0] ?? Object.values(decision)[0])!.route,
      chat,
      decision,
    }
  }
  const codex = codexProvider(document.openai)
  if (codex) document[CODEX_PROVIDER_ID] = codex
  return document
}

/** A stored document read back, or undefined when it is not one this version wrote. */
export function readDocument(value: unknown): CatalogDocument | undefined {
  if (!isRecord(value)) return undefined
  for (const provider of Object.values(value)) {
    if (
      !isRecord(provider) ||
      !isRecord(provider.chat) ||
      !isRecord(provider.decision) ||
      !isRecord(provider.route) ||
      !Array.isArray(provider.settings)
    )
      return undefined
  }
  return Object.keys(value).length > 0 ? (value as CatalogDocument) : undefined
}

/** One model as the host's picker lists it. */
export function listedModel(
  provider: Pick<ServedProvider, 'id' | 'name'>,
  model: ServedModel,
  kind: 'chat' | 'decision',
): CatalogModel {
  return {
    id: `${provider.id}/${model.id}`,
    ...(kind === 'decision' ? { kind } : {}),
    providerId: provider.id,
    providerName: provider.name,
    name: model.name,
    supportsTools: model.tools,
    supportsReasoning: model.reasons,
    reasoningEfforts: model.reasons ? [...model.reasoning] : ['off'],
    api: apiOf(model.route, kind),
    supportsAttachment: model.attachment,
    inputModalities: [...model.input],
    outputModalities: [...model.output],
    ...(model.contextWindow ? { contextLength: model.contextWindow } : {}),
    ...(model.maxOutputTokens && kind === 'chat' ? { outputLimit: model.maxOutputTokens } : {}),
    ...(model.cost ? { cost: structuredClone(model.cost) } : {}),
    ...(model.releaseDate ? { releaseDate: model.releaseDate } : {}),
    ...(model.family ? { family: model.family } : {}),
  }
}

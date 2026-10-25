import { createHash } from 'node:crypto'
import { z } from 'zod'
import { researchPermissionResources } from './research-resources'
import { defineAgentTool, type AgentSource, type AgentToolResult } from '@localixai/agent/agents'
import { errorMessage } from '../../../../lib/errors'
import { TOOL } from '../../tool-names'
import { fetchReadablePage, type ReadablePageDeps } from './research-fetch'
import type { HttpFetch } from './net-safety'
import {
  RESEARCH_BACKENDS,
  ResearchBackendCooldownError,
  type ResearchBackend,
  type ResearchSourceType,
} from './research-backends'
import {
  normalizeResearchDomain,
  rankResearchCandidates,
  selectResearchCandidates,
  type RankedResearchCandidate,
  type ResearchObservation,
} from './research-ranking'

import { prepareResearchArguments } from './research-input'

export { type ResearchBackend, type ResearchSourceType }

const boundedQuery = z.string().trim().min(1).max(500)
const boundedDomain = z.string().trim().min(1).max(253)

/**
 * One composite search→read contract. `question` anchors the evidence packet;
 * callers can control discovery without depending on engine-specific
 * arguments. When URLs are supplied without queries, research reads only those
 * URLs; otherwise `question` is the fallback query.
 */
export const researchInputSchema = z.object({
  question: z.string().trim().min(1).max(2_000).describe('What the evidence must answer.'),
  queries: z
    .array(boundedQuery)
    .min(1)
    .max(4)
    .optional()
    .describe('Focused search queries (default: the question; none when only urls are given).'),
  urls: z
    .array(z.string().trim().min(1).max(4_096))
    .max(8)
    .optional()
    .describe('Known sources to read first.'),
  source_types: z
    .array(z.enum(['web', 'academic', 'code', 'community', 'encyclopedia']))
    .min(1)
    .max(5)
    .optional()
    .describe('Discovery lanes to combine (default ["web"]).'),
  max_sources: z.number().int().min(1).max(8).optional().describe('Pages to read (default 5).'),
  include_domains: z
    .array(boundedDomain)
    .max(10)
    .optional()
    .describe('Only these domains and their subdomains.'),
  exclude_domains: z.array(boundedDomain).max(10).optional(),
  recency_days: z
    .number()
    .int()
    .min(1)
    .max(3_650)
    .optional()
    .describe('Prefer results from the last N days.'),
})

export type ResearchInput = z.infer<typeof researchInputSchema>

export interface ResearchSearchRun {
  query: string
  provider: ResearchBackend
  sourceType: ResearchSourceType
  resultCount: number
  strategy?: string
  durationMs: number
  skipped?: boolean
  error?: string
}

export interface ResearchDetails {
  question: string
  queries: string[]
  sourceTypes: ResearchSourceType[]
  providers: ResearchBackend[]
  candidateCount: number
  consultedCount: number
  failedCount: number
  searches: ResearchSearchRun[]
}

export interface ResearchConfig {
  userAgent: string
  /** Internal/test override; production uses every keyless backend. */
  backends: ResearchBackend[]
  maxSources: number
  resultsPerQuery: number
  maxBackendConcurrency: number
  maxFetchConcurrency: number
  searchTimeoutMs: number
  maxSearchResponseBytes: number
  pageTimeoutMs: number
  maxBytesPerSource: number
  maxCharsPerSource: number
  maxTotalChars: number
  allowPrivate: boolean
}

export interface ResearchDeps {
  fetchImpl?: HttpFetch
  resolveHost?: ReadablePageDeps['resolveHost']
  config?: Partial<ResearchConfig>
}

function resolveConfig(overrides?: Partial<ResearchConfig>): ResearchConfig {
  return {
    userAgent: 'Mozilla/5.0 (compatible; localix-research/1.0)',
    backends: Object.keys(RESEARCH_BACKENDS) as ResearchBackend[],
    maxSources: 5,
    resultsPerQuery: 8,
    maxBackendConcurrency: 4,
    maxFetchConcurrency: 3,
    searchTimeoutMs: 30_000,
    maxSearchResponseBytes: 1_000_000,
    pageTimeoutMs: 15_000,
    maxBytesPerSource: 4_000_000,
    maxCharsPerSource: 8_000,
    maxTotalChars: 32_000,
    allowPrivate: false,
    ...overrides,
  }
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parent?.reason)
  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('Research search timed out')),
    timeoutMs,
  )
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abortFromParent)
    },
  }
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const workers = Array.from(
    { length: Math.min(values.length, Math.max(1, Math.trunc(concurrency))) },
    async () => {
      for (;;) {
        const index = next++
        if (index >= values.length) return
        out[index] = await task(values[index]!, index)
      }
    },
  )
  await Promise.all(workers)
  return out
}

function normalizedDomains(values: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    const domain = normalizeResearchDomain(value)
    if (domain && !out.includes(domain)) out.push(domain)
  }
  return out
}

/**
 * Deliberately NOT `agentSourceId` from `@localixai/agent/agents`, which the other two producers
 * now share. That helper is a 32-bit FNV-1a; this module already imports node:crypto and mints ids
 * for arbitrary web URLs, so swapping a 256-bit hash for a 32-bit one to make the diff tidier
 * would trade robustness for nothing. Both are safe either way — dedupe keys on `kind\0uri`, never
 * on the id — so the difference costs nothing but is worth stating so nobody "unifies" it later.
 */
function sourceId(url: string): string {
  return `web-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

function compactSnippet(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function candidateReadHost(candidate: RankedResearchCandidate): string {
  try {
    return new URL(candidate.readUrl ?? candidate.url).hostname.toLowerCase()
  } catch {
    return candidate.url
  }
}

interface ReadEvidence {
  source: AgentSource
  evidence?: string
}

async function readCandidate(
  candidate: RankedResearchCandidate,
  cfg: ResearchConfig,
  deps: ResearchDeps,
  signal?: AbortSignal,
): Promise<ReadEvidence> {
  const result = await fetchReadablePage(
    { url: candidate.readUrl ?? candidate.url, format: 'markdown' },
    {
      fetchImpl: deps.fetchImpl,
      resolveHost: deps.resolveHost,
      signal,
      config: {
        userAgent: cfg.userAgent,
        timeoutMs: cfg.pageTimeoutMs,
        maxBytes: cfg.maxBytesPerSource,
        maxChars: cfg.maxCharsPerSource,
        allowPrivate: cfg.allowPrivate,
      },
    },
  )
  const retrievedAt = new Date().toISOString()
  if (result.isError) {
    return {
      source: {
        id: sourceId(candidate.url),
        kind: candidate.sourceTypes[0] ?? 'web',
        title: candidate.title,
        uri: candidate.url,
        role: 'discovered',
        status: 'failed',
        provider: candidate.providers.join(', ') || 'direct',
        snippet: compactSnippet(result.content),
        retrievedAt,
        metadata: {
          sourceTypes: candidate.sourceTypes.join(','),
          ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
        },
      },
    }
  }

  const finalUrl = candidate.readUrl ? candidate.url : (result.details?.finalUrl ?? candidate.url)
  const evidence = result.content.trim().slice(0, cfg.maxCharsPerSource)
  return {
    source: {
      id: sourceId(finalUrl),
      kind: candidate.sourceTypes[0] ?? 'web',
      title: result.details?.title ?? candidate.title,
      uri: finalUrl,
      role: 'consulted',
      status: 'available',
      provider: candidate.providers.join(', ') || 'direct',
      snippet: compactSnippet(candidate.snippet || evidence),
      retrievedAt,
      metadata: {
        queryCount: candidate.queries.length,
        providerCount: candidate.providers.length,
        sourceTypes: candidate.sourceTypes.join(','),
        ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
      },
    },
    evidence,
  }
}

function renderEvidence(
  question: string,
  reads: readonly ReadEvidence[],
  maxTotalChars: number,
): string {
  const consulted = reads.filter((read) => read.evidence)
  let remaining = maxTotalChars
  const sections: string[] = []
  for (const [index, read] of consulted.entries()) {
    const header = `[S${index + 1}] ${read.source.title}\nURL: ${read.source.uri}\n`
    const budget = Math.max(0, remaining - header.length)
    if (!budget) break
    const body = read.evidence!.slice(0, budget)
    sections.push(`${header}\n${body}`)
    remaining -= header.length + body.length
  }
  const failed = reads.filter((read) => read.source.status === 'failed')
  const warning = failed.length
    ? `\n\nUnread sources (${failed.length}):\n${failed.map((read) => `- ${read.source.uri}: ${read.source.snippet ?? 'read failed'}`).join('\n')}`
    : ''
  return [
    `Research evidence for: ${question}`,
    'Use the stable [S#] labels when attributing claims. A source appears here only when its page was actually read.',
    sections.join('\n\n---\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(warning)
}

/** Run the provider-agnostic composite research pipeline. */
export async function runResearch(
  input: ResearchInput,
  deps: ResearchDeps & { signal?: AbortSignal } = {},
): Promise<AgentToolResult<ResearchDetails>> {
  const cfg = resolveConfig(deps.config)
  const maxSources = Math.min(input.max_sources ?? cfg.maxSources, 8)
  const sourceTypes = [
    ...new Set<ResearchSourceType>(input.source_types?.length ? input.source_types : ['web']),
  ]
  const includeDomains = normalizedDomains(input.include_domains)
  const excludeDomains = normalizedDomains(input.exclude_domains)
  const overlap = includeDomains.find((domain) => excludeDomains.includes(domain))
  if (overlap) {
    return {
      content: `research failed: domain "${overlap}" cannot be both included and excluded.`,
      isError: true,
    }
  }

  const queries = [
    ...new Set(
      (input.queries?.length ? input.queries : input.urls?.length ? [] : [input.question]).map(
        (query) => query.trim(),
      ),
    ),
  ].slice(0, 4)
  const backends = queries.length
    ? cfg.backends.filter(
        (backend, index) =>
          RESEARCH_BACKENDS[backend] &&
          cfg.backends.indexOf(backend) === index &&
          sourceTypes.includes(RESEARCH_BACKENDS[backend].sourceType),
      )
    : []

  const searchTimeout = timeoutSignal(deps.signal, cfg.searchTimeoutMs)
  let searches: ResearchSearchRun[] = []
  let observations: ResearchObservation[] = []
  try {
    const backendRuns = await mapLimit(backends, cfg.maxBackendConcurrency, async (provider) => {
      const spec = RESEARCH_BACKENDS[provider]
      const providerSearches: ResearchSearchRun[] = []
      const providerObservations: ResearchObservation[] = []
      let cooldownReason: string | undefined

      for (const query of queries) {
        if (cooldownReason) {
          providerSearches.push({
            query,
            provider,
            sourceType: spec.sourceType,
            resultCount: 0,
            durationMs: 0,
            skipped: true,
            error: cooldownReason,
          })
          continue
        }

        const startedAt = performance.now()
        try {
          const result = await spec.search(
            {
              doFetch: deps.fetchImpl ?? fetch,
              userAgent: cfg.userAgent,
              maxResponseBytes: cfg.maxSearchResponseBytes,
              signal: searchTimeout.signal,
            },
            {
              query,
              count: cfg.resultsPerQuery,
              includeDomains,
              excludeDomains,
              recencyDays: input.recency_days,
            },
          )
          providerSearches.push({
            query,
            provider,
            sourceType: spec.sourceType,
            resultCount: result.hits.length,
            durationMs: Math.round(performance.now() - startedAt),
            ...(result.strategy ? { strategy: result.strategy } : {}),
          })
          providerObservations.push(
            ...result.hits.map((hit, index) => ({
              query,
              provider,
              rank: index + 1,
              hit,
            })),
          )
          if (result.cooldownMs) {
            cooldownReason = `provider requested ${Math.ceil(result.cooldownMs / 1_000)}s backoff`
          }
        } catch (error) {
          const message = errorMessage(error)
          providerSearches.push({
            query,
            provider,
            sourceType: spec.sourceType,
            resultCount: 0,
            durationMs: Math.round(performance.now() - startedAt),
            error: message,
          })
          if (error instanceof ResearchBackendCooldownError) {
            cooldownReason = `${message}; cooldown ${Math.ceil(error.cooldownMs / 1_000)}s`
          }
        }
      }

      return {
        searches: providerSearches,
        observations: providerObservations,
      }
    })
    searches = backendRuns.flatMap((run) => run.searches)
    observations = backendRuns.flatMap((run) => run.observations)
  } finally {
    searchTimeout.dispose()
  }

  const ranked = rankResearchCandidates({
    observations,
    suppliedUrls: input.urls,
    includeDomains,
    excludeDomains,
  })
  // Read enough alternates to recover from dead/private/paywalled top results,
  // but keep a hard global attempt ceiling. Batches only fill slots left by
  // failures, so successful pages never exceed the user-visible maxSources.
  const maxAttempts = Math.min(8, Math.max(maxSources, maxSources * 2))
  const selected = selectResearchCandidates(ranked, maxAttempts)
  const detailsBase = {
    question: input.question,
    queries,
    sourceTypes,
    providers: backends,
    candidateCount: ranked.length,
  }
  if (selected.length === 0) {
    const failures = searches.filter((run) => run.error)
    const reason = failures.length
      ? failures.map((run) => `${run.provider}: ${run.error}`).join('; ')
      : 'no matching results'
    return {
      content: `research found no readable candidates for "${input.question}" (${reason}).`,
      details: { ...detailsBase, consultedCount: 0, failedCount: 0, searches },
      isError: true,
    }
  }

  // Respect public endpoints and origin servers even when global page reading is
  // concurrent. Crossref's keyless pool, for example, explicitly allows only one
  // concurrent request; the same per-host serialization is a polite default for
  // ordinary pages and prevents two selected results on one site from racing.
  const hostTails = new Map<string, Promise<void>>()
  const readOne = async (candidate: RankedResearchCandidate): Promise<ReadEvidence> => {
    const host = candidateReadHost(candidate)
    const previous = hostTails.get(host) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    hostTails.set(host, tail)
    await previous
    try {
      return await readCandidate(candidate, cfg, deps, deps.signal)
    } finally {
      release()
      if (hostTails.get(host) === tail) hostTails.delete(host)
    }
  }

  const reads: ReadEvidence[] = []
  let cursor = 0
  let consulted = 0
  while (cursor < selected.length && consulted < maxSources) {
    const openSlots = maxSources - consulted
    const batch = selected.slice(cursor, cursor + openSlots)
    cursor += batch.length
    const batchReads = await mapLimit(batch, cfg.maxFetchConcurrency, readOne)
    reads.push(...batchReads)
    consulted += batchReads.filter((read) => read.evidence).length
  }
  const sources = reads.map((read) => read.source)
  const consultedCount = reads.filter((read) => read.evidence).length
  const failedCount = reads.length - consultedCount
  const details: ResearchDetails = {
    ...detailsBase,
    consultedCount,
    failedCount,
    searches,
  }
  if (consultedCount === 0) {
    return {
      content: `research found ${selected.length} candidate source(s), but none could be read safely.`,
      details,
      sources,
      isError: true,
    }
  }
  return {
    content: renderEvidence(input.question, reads, cfg.maxTotalChars),
    details,
    sources,
  }
}

export { researchPermissionResources }

export function createResearchTool(deps: ResearchDeps = {}) {
  return defineAgentTool<ResearchInput, ResearchDetails>({
    name: TOOL.research,
    label: 'Research',
    activeVerb: 'Researching',
    description:
      'Research a question in one call: search, rank across providers, safely read the best pages, and return source-labelled evidence. Pass known urls to read primary sources directly.',
    inputSchema: researchInputSchema,
    prepareArguments: prepareResearchArguments,
    permissionResources: researchPermissionResources,
    mutates: false,
    executionMode: 'parallel',
    contextClass: 'readResult',
    /**
     * Past two minutes, keep researching in the background rather than blocking the turn.
     *
     * The per-leg budgets bound each search (30s) and each page read (15s), but not the
     * aggregate: several queries across several providers legitimately run for minutes, and
     * until now the only way out of that wait was the user pressing Stop. "Still researching,
     * I will tell you when it lands" is a truthful thing to say about this work, which is what
     * makes promotion the right answer here and the wrong one for a tool whose whole result
     * is what the model is waiting on. It also honours its `signal`, so the job's stop
     * actually stops it.
     */
    promoteAfterMs: 120_000,
    async execute(_toolCallId, input, signal) {
      return runResearch(input, { ...deps, signal })
    },
  })
}

/**
 * `GlobalSearch` — the search palette for the agent, and its conversation-history reader.
 *
 * QUERY runs the SAME `SearchService` the palette and the search tab call: the same providers
 * (chats, messages, projects, the session's files, skills, plugins, MCP servers, agents, models
 * and every enabled plugin's domain), the same ranking and the same strategy — words, or words
 * and meaning when the person turned semantic search on. `domains` narrows it to categories.
 * Nothing here ranks on its own, so the agent and the person never get different answers.
 *
 * The other two modes are conversation reads (formerly `history_search`): `around_message_id`
 * and/or `session_id` SCROLL a transcript; no arguments BROWSE recent sessions. A host built
 * without the search service still answers a query from full-text message history.
 *
 * Scope follows the session the way the palette follows the open chat: this session's project
 * and workspace by default, every project with `scope: "everywhere"`.
 */
import { z } from 'zod'
import { defineAgentTool, type AgentToolResult } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import { sessionSource } from '../source-refs'
import type { SearchRequest, SearchResponse } from '../../../search/contracts'
import { createHistoryModes, type HistorySearchRepo } from '../history/history-search'
import { capPayload, strategyLine, toModelGroups, withoutSession } from './global-search-format'

/** What the tool needs from the host: the one search service. */
export interface GlobalSearchPort {
  search(userId: string, request: SearchRequest): Promise<SearchResponse>
}

export interface GlobalSearchToolOptions {
  /** Absent in a host without global search: a query then reads message history only. */
  port?: GlobalSearchPort
  history: HistorySearchRepo
  userId: string
  sessionId: string
  projectId: string | null
}

const DEFAULT_PER_GROUP = 5
const MAX_PER_GROUP = 20

export const globalSearchInputSchema = z.object({
  query: z.string().min(1).optional().describe('What to find.'),
  domains: z
    .array(z.string().min(1))
    .max(12)
    .optional()
    .describe('Only these categories, e.g. ["messages"], ["sessions"], ["files"].'),
  scope: z
    .enum(['project', 'everywhere'])
    .optional()
    .describe('Default project: this session’s project.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PER_GROUP)
    .optional()
    .describe(`Hits per category (default ${DEFAULT_PER_GROUP}); sessions when browsing.`),
  around_message_id: z.string().optional().describe('Read: messages around this one.'),
  session_id: z.string().optional().describe('Read: this session (its end, unless around).'),
  window: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Read: messages each side (default 5).'),
})

type Input = z.infer<typeof globalSearchInputSchema>

export function createGlobalSearchTool(options: GlobalSearchToolOptions) {
  const { port, userId, sessionId, projectId } = options
  const history = createHistoryModes(options.history, userId)

  async function search(input: Input & { query: string }): Promise<AgentToolResult<unknown>> {
    if (!port) return history.discover(input.query, input.limit)
    const scoped = input.domains?.length === 1
    let response: SearchResponse
    try {
      response = await port.search(userId, {
        text: input.query,
        ...(input.domains?.length ? { domains: input.domains } : {}),
        limit: input.limit ?? (scoped ? DEFAULT_PER_GROUP * 2 : DEFAULT_PER_GROUP),
        sessionId,
        projectId,
        ...(input.scope === 'everywhere' ? { allProjects: true } : {}),
      })
    } catch (error) {
      return {
        content: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
    const groups = withoutSession(toModelGroups(response), sessionId)
    const details = {
      mode: 'search',
      query: input.query,
      total: response.total,
      strategy: response.strategy,
    }
    if (groups.length === 0) {
      const unreachable = response.problems?.map((p) => p.message).join('; ')
      return {
        content: `No matches for "${input.query}" (${strategyLine(response)}).${unreachable ? ` Could not search: ${unreachable}.` : ''}`,
        details,
      }
    }
    const payload = {
      query: input.query,
      matching: strategyLine(response),
      groups,
      ...(response.problems?.length
        ? { could_not_search: response.problems.map((p) => p.message) }
        : {}),
    }
    // Discovered, not consulted: a hit says where something is, not what it says.
    const sessions = new Map<string, string>()
    for (const g of groups) {
      for (const h of g.hits) {
        if (h.session_id && !sessions.has(h.session_id)) {
          sessions.set(h.session_id, g.domain === 'sessions' ? h.title : '')
        }
      }
    }
    return {
      content: capPayload(payload),
      details,
      sources: [...sessions].map(([id, title]) =>
        sessionSource({ sessionId: id, ...(title ? { title } : {}), role: 'discovered' as const }),
      ),
    }
  }

  return defineAgentTool({
    name: TOOL.GlobalSearch,
    label: 'Search',
    activeVerb: 'Searching',
    description:
      'Find what the person could find in Localix search (chats, messages, files, projects, skills, plugins, agents, plugin data), ranked as the search palette ranks it — by meaning too when semantic search is on. ' +
      'Also reads conversations: around_message_id and/or session_id show a transcript; no arguments list recent sessions. Use it for the person’s own earlier work, never for general knowledge.',
    inputSchema: globalSearchInputSchema,
    mutates: false,
    executionMode: 'parallel',
    async execute(_toolCallId, input): Promise<AgentToolResult<unknown>> {
      if (input.around_message_id || input.session_id) {
        return history.scroll(
          input.session_id ?? null,
          input.around_message_id ?? null,
          input.window,
        )
      }
      if (input.query) return search({ ...input, query: input.query })
      return history.browse(input.limit)
    },
  })
}

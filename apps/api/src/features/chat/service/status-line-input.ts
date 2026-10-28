import { DEFAULT_AGENT_NAME } from '../../../db/author'
import { sessionRoute } from '../../../contracts/session-route'
import { CLAUDE_CODE_BASE_VERSION } from '../../cc-settings/claude-code-version'
import { ccEffortLevel } from '../runtime/run/cc-hook-run-facts'
import type { SessionRecord } from '../repository'
import type { StatusLineUsage } from './status-line-usage'
import type { StatusLineWorkspace } from './status-line-workspace'

/** What the model catalog says of the route's model; every field only when it is known. */
export interface StatusLineModelInfo {
  name?: string
  contextLength?: number
  supportsReasoning?: boolean
}

export interface StatusLineInputFacts {
  session: SessionRecord
  cwd: string
  addedDirs: readonly string[]
  usage: StatusLineUsage
  model?: StatusLineModelInfo
  workspace?: StatusLineWorkspace
  transcriptPath?: string
  now?: number
}

const CACHE_LIFETIME_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

/**
 * `prompt_cache` (statusline.md, "Prompt cache fields"). The session-wide numbers are the
 * conversation's; `warm`, `expires_at` and `recache_tokens_if_cold` are the LAST response's, which
 * is how a script tells "cold" from "a low hit ratio": it prints cold for anything but
 * `warm: true`. Warm needs that response to have read or written cache and to be inside the
 * cache's lifetime; a response that reported neither leaves `expires_at` null, as does the
 * compaction that rewrote the conversation. Requests and misses are not counted per request here,
 * so those fields are left out.
 */
function promptCache(usage: StatusLineUsage, last: StatusLineUsage['lastRequest'], now: number) {
  const cache = usage.cache!
  const ttl = cache.longLived ? '1h' : '5m'
  const cached = last ? last.cacheReadTokens + last.cacheWriteTokens > 0 : false
  const expiresMs =
    cached && cache.lastResponseAt !== undefined
      ? cache.lastResponseAt + CACHE_LIFETIME_MS[ttl]
      : undefined
  return {
    warm: expiresMs !== undefined && expiresMs > now,
    caching_observed: cache.observed,
    ttl,
    expires_at: expiresMs === undefined ? null : Math.floor(expiresMs / 1000),
    hit_ratio: cache.hitRatio,
    cache_write_tokens: cache.writeTokens,
    recache_tokens_if_cold: last ? last.inputTokens : null,
  }
}

/**
 * The session as the command reads it on stdin (statusline.md, "Available data"). A field Localix
 * cannot know is left out, as the page's "may be absent" rules allow: nothing is sent as a
 * placeholder. Pull requests, rate limits, vim mode and worktree sessions are not known here;
 * lines changed and API time are not tracked per conversation.
 */
export function statusLineInput(facts: StatusLineInputFacts) {
  const { session, cwd, usage, model, workspace } = facts
  const route = sessionRoute(session)
  const modelId = route?.modelId ?? ''
  const last = usage.compacted ? undefined : usage.lastRequest
  const size = usage.contextSize ?? model?.contextLength
  const usedPercentage = last && size ? Math.round((last.inputTokens / size) * 100) : null
  const effort = ccEffortLevel(route?.reasoningEffort)
  const reasons = route?.reasoningEffort !== 'off' && model?.supportsReasoning !== false
  const started = Date.parse(session.createdAt)
  return {
    cwd,
    session_id: session.id,
    ...(session.title ? { session_name: session.title } : {}),
    ...(usage.promptId ? { prompt_id: usage.promptId } : {}),
    transcript_path: facts.transcriptPath ?? '',
    model: { id: modelId, display_name: model?.name ?? modelId },
    workspace: {
      current_dir: cwd,
      project_dir: cwd,
      added_dirs: [...facts.addedDirs],
      ...(workspace?.worktree ? { git_worktree: workspace.worktree } : {}),
      ...(workspace?.repo ? { repo: workspace.repo } : {}),
    },
    version: CLAUDE_CODE_BASE_VERSION,
    ...(session.outputStyle ? { output_style: { name: session.outputStyle } } : {}),
    cost: {
      total_cost_usd: usage.totalCost ?? 0,
      total_duration_ms: Math.max(0, (facts.now ?? Date.now()) - (started || Date.now())),
    },
    context_window: {
      // Input includes cache reads and writes; the percentage counts input alone.
      total_input_tokens: last?.inputTokens ?? 0,
      total_output_tokens: last?.outputTokens ?? 0,
      context_window_size: size ?? null,
      used_percentage: usedPercentage,
      remaining_percentage: usedPercentage === null ? null : Math.max(0, 100 - usedPercentage),
      current_usage: last
        ? {
            input_tokens: Math.max(
              0,
              last.inputTokens - last.cacheReadTokens - last.cacheWriteTokens,
            ),
            output_tokens: last.outputTokens,
            cache_creation_input_tokens: last.cacheWriteTokens,
            cache_read_input_tokens: last.cacheReadTokens,
          }
        : null,
    },
    exceeds_200k_tokens: last ? last.inputTokens + last.outputTokens > 200_000 : false,
    ...(usage.cache ? { prompt_cache: promptCache(usage, last, facts.now ?? Date.now()) } : {}),
    // Localix has no fast mode.
    fast_mode: false,
    ...(effort ? { effort: { level: effort } } : {}),
    thinking: { enabled: reasons },
    ...(route?.name && route.name !== DEFAULT_AGENT_NAME ? { agent: { name: route.name } } : {}),
  }
}

import type { QuotaReading, SessionSummary } from '../../shared/contracts'
import type { FoldedSummary, SourceRef } from './types'
import { parseWindowLines, readHead } from './fs-read'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, asNumber as numberOf, firstText } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator, usageDelta } from './usage'
import { foldOnward, resumableFold, usageEnd } from './summary-fold'
import type { TokenUsage } from '../../shared/contracts'

export const ID = 'codex'
/**
 * 256 KB, not 64 KB. Codex's first line is the `session_meta` record, whose `base_instructions`
 * blob alone is ~16 KB, and on a real 6 MB rollout the first `user_message` sat at byte 87005.
 * A 64 KB head produced a title-less row; this budget was chosen from that measurement.
 */
const HEAD_BYTES = 256 * 1024

/**
 * One `rate_limits` slot as a reading, or nothing. Every field is required: a window without a reset
 * cannot be told from an expired one, and a percentage without a window is a number about nothing.
 */
function quotaOf(
  slot: Record<string, unknown> | undefined,
  planType: string | undefined,
  observedAt: number,
): QuotaReading | undefined {
  if (!slot) return undefined
  const usedPercent = numberOf(slot.used_percent)
  const windowMinutes = numberOf(slot.window_minutes)
  const resetsAtSeconds = numberOf(slot.resets_at)
  if (usedPercent === undefined || !windowMinutes || !resetsAtSeconds) return undefined
  return {
    usedPercent,
    windowMinutes,
    // Codex writes unix SECONDS here; every timestamp we hold is ms.
    resetsAt: resetsAtSeconds * 1000,
    ...(planType ? { planType } : {}),
    observedAt,
  }
}

/** One Codex counter object; input includes cache reads, and output already includes reasoning. */
function codexSample(counters: Record<string, unknown>) {
  return normalizeTokenSample({
    inputTokens: numberOf(counters.input_tokens),
    cachedInputTokens: numberOf(counters.cached_input_tokens ?? counters.cache_read_input_tokens),
    cacheWriteTokens: numberOf(counters.cache_write_input_tokens),
    outputTokens: numberOf(counters.output_tokens),
    reasoningTokens: numberOf(counters.reasoning_output_tokens),
    totalTokens: numberOf(counters.total_tokens),
    inputIncludesCached: true,
  })
}

/** What a cut through a rollout has to carry: the cumulative counter and model it stood at. */
type Carry = {
  readonly previousTotal?: TokenUsage
  readonly currentModel?: string
}

/** The records this fold reads; everything else in a rollout is skipped before it is parsed. */
const FOLDED_LINE = (line: string) =>
  line.includes('"token_count"') || line.includes('"turn_context"') || line.includes('"message"')

export async function summarizeCodex(ref: SourceRef): Promise<SessionSummary> {
  return (await foldCodex(ref, undefined)).summary
}

/** Head fields once; usage, quotas and the message count from where the previous fold stopped. */
export async function foldCodex(
  ref: SourceRef,
  previous: FoldedSummary | undefined,
): Promise<FoldedSummary> {
  const resumed = await resumableFold(ref, previous)
  // The head is final once the previous fold read past it; before that, a live rollout may not yet
  // have reached its first prompt, and keeping its placeholder title would keep it for good.
  const identity =
    resumed && (resumed.fold?.offset ?? 0) >= HEAD_BYTES ? resumed.summary : await readIdentity(ref)
  const usage = await foldUsage(ref, resumed)
  const measured = usage?.accumulator.result()
  const summary: SessionSummary = {
    key: linkKeyOf({ provider: ID, nativeSessionId: ref.nativeSessionId }),
    provider: ID,
    nativeSessionId: ref.nativeSessionId,
    title: identity.title,
    cwd: identity.cwd,
    startedAt: identity.startedAt,
    updatedAt: ref.updatedAtHint ?? Date.now(),
    ...(usage && usage.messageCount > 0 ? { messageCount: usage.messageCount } : {}),
    ...(measured ? { usage: measured } : {}),
    ...(usage && usage.quotas.size > 0 ? { quotas: [...usage.quotas.values()] } : {}),
    sourcePath: ref.sourcePath,
    ...(identity.parentNativeSessionId
      ? { parentNativeSessionId: identity.parentNativeSessionId }
      : {}),
  }
  return { summary, ...(usage ? { fold: usage.fold } : {}) }
}

async function readIdentity(ref: SourceRef) {
  const head = await readHead(ref.sourcePath, HEAD_BYTES)
  const records = parseWindowLines(head, 'head')
  let cwd: string | undefined
  let startedAt: number | undefined
  let firstPrompt: string | undefined
  let parentNativeSessionId: string | undefined
  for (const rec of records) {
    const payload = asRecord(rec.payload)
    if (rec.type === 'session_meta' && payload) {
      cwd ??= asString(payload.cwd)
      const ts = asString(payload.timestamp)
      if (ts) startedAt ??= Date.parse(ts) || undefined
      const source = asRecord(payload.source)
      const subagent = asRecord(source?.subagent)
      const spawn = asRecord(subagent?.thread_spawn)
      parentNativeSessionId ??= asString(spawn?.parent_thread_id)
    }
    if (!firstPrompt && rec.type === 'event_msg' && payload?.type === 'user_message') {
      const message = asString(payload.message)
      // Codex injects an `<environment_context>` preamble as a user turn; it is not the request.
      if (message && !message.startsWith('<environment_context>')) firstPrompt = message
    }
  }
  const title =
    firstText(firstPrompt, 120) ??
    (cwd ? `Codex in ${cwd.slice(cwd.lastIndexOf('/') + 1)}` : ref.nativeSessionId)
  return { title, cwd, startedAt, parentNativeSessionId }
}

async function foldUsage(ref: SourceRef, resumed: FoldedSummary | undefined) {
  const end = usageEnd(ref)
  if (end === undefined) return undefined
  const usage = SessionUsageAccumulator.from(resumed?.summary.usage)
  const quotas = new Map<number, QuotaReading>(
    (resumed?.summary.quotas ?? []).map((quota) => [quota.windowMinutes, quota]),
  )
  const carry = (resumed?.fold?.carry ?? {}) as Carry
  let previousTotal = carry.previousTotal
  let currentModel = carry.currentModel
  let messageCount = resumed?.summary.messageCount ?? 0
  const fold = await foldOnward(
    ref,
    resumed,
    end,
    FOLDED_LINE,
    (rec) => {
      const payload = asRecord(rec.payload)
      if (!payload) return
      if (rec.type === 'turn_context') {
        currentModel = asString(payload.model) ?? currentModel
        return
      }
      if (rec.type === 'response_item' && payload.type === 'message') {
        const role = asString(payload.role)
        if (role === 'user' || role === 'assistant') messageCount += 1
        return
      }
      if (rec.type !== 'event_msg' || payload.type !== 'token_count') return
      // The account's quota windows ride on the SAME event as the token counters, so reading them
      // costs nothing this walk was not already paying. Both slots are read and keyed on the
      // window's LENGTH, because `primary` does not name a fixed window: with two open, `primary` is
      // the 5-hour one and the weekly moves to `secondary`. Last reading of each window wins.
      const limits = asRecord(payload.rate_limits)
      if (limits) {
        const planType = asString(limits.plan_type)
        const at = Date.parse(asString(rec.timestamp) ?? '') || Date.now()
        for (const slot of [limits.primary, limits.secondary]) {
          const reading = quotaOf(asRecord(slot), planType, at)
          if (reading) quotas.set(reading.windowMinutes, reading)
        }
      }
      const info = asRecord(payload.info)
      const total = asRecord(info?.total_token_usage)
      const last = asRecord(info?.last_token_usage)
      const timestampText = asString(rec.timestamp)
      const timestamp = timestampText ? Date.parse(timestampText) || undefined : undefined
      currentModel = asString(info?.model) ?? currentModel
      if (total) {
        const normalized = codexSample(total)
        usage.add(usageDelta(normalized, previousTotal), currentModel, timestamp)
        previousTotal = normalized
      } else if (last) {
        usage.add(codexSample(last), currentModel, timestamp)
      }
    },
    (): Carry => ({
      ...(previousTotal ? { previousTotal } : {}),
      ...(currentModel ? { currentModel } : {}),
    }),
  )
  return {
    accumulator: usage,
    quotas,
    messageCount,
    fold,
  }
}
